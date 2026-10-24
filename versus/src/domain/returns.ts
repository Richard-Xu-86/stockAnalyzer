import { isMarketOpen, tradingDaysBetween } from "@/lib/calendar";
import { D, ONE, ZERO, dec, sum, type Dec } from "./decimal";
import type { FlowAnalysis } from "./flows";
import { rateTo } from "./fx";
import { BENCHMARKS, type BenchmarkSeries, type Ccy, type PositionRow, type Snapshot } from "./types";

/**
 * Daily time-weighted returns between consecutive usable snapshots.
 *
 *   r = (V_end − F) / V_start − 1
 *
 * V = every holding priced at that end + cash + money in transit, in the reporting currency,
 * restricted to accounts present at both ends (an account added or removed is therefore neither
 * a gain nor a loss). A holding bought or sold during the day counts at the end where it exists,
 * so a trade moves value between cash and holdings without creating a return. A holding that
 * exists at both ends but is unpriced at one is left out of both (and lowers coverage).
 * F = external flows dated after the start and up to the end, assumed at day end, plus any
 * transfer leg whose other account is not being compared that day. Nothing is guessed: any
 * missing input excludes the day with a stated reason.
 */
export const MIN_START_VALUE = new D(100); // below this, percentages are noise
export const MIN_COVERAGE = new D("0.9");

export type DayStatus = "ok" | "provisional" | "excluded";

export interface HoldingEffect {
  ticker: string;
  priceEffect: Dec;
  currencyEffect: Dec;
}

export interface DayResult {
  date: string;
  prevDate: string;
  spans: number; // trading days covered (1 normally; more after a missed run)
  status: DayStatus;
  reason: string | null;
  r: Dec | null;
  b: Dec | null;
  coverage: Dec | null;
  valueEnd: Dec | null;
  benchmarkMarketClosed: boolean;
  drivers: { holdings: HoldingEffect[]; cashCurrencyEffect: Dec; remainder: Dec } | null;
  /** Set when consecutive days were combined because the market price for these closes is missing. */
  combinedOver?: string[];
}

const key = (p: PositionRow) => `${p.accountId}|${p.symbolKey}`;

interface Side {
  priced: Map<string, PositionRow>;
  all: PositionRow[];
}

function side(s: Snapshot, accounts: ReadonlySet<string>): Side {
  const all = s.positions.filter((p) => accounts.has(p.accountId));
  const priced = new Map<string, PositionRow>();
  for (const p of all) if (dec(p.price) && dec(p.units)) priced.set(key(p), p);
  return { priced, all };
}

const holdingValue = (p: PositionRow, rate: Dec): Dec => dec(p.units)!.times(dec(p.price)!).times(dec(p.multiplier) ?? ONE).times(rate);

/** Money between two compared accounts on `date`: it has left one and not yet reached the other. */
function transitOn(date: string, flows: FlowAnalysis, accounts: ReadonlySet<string>, rate: (from: string) => Dec | null): Dec | null {
  let total = ZERO;
  for (const t of flows.transits) {
    if (!accounts.has(t.outAccountId) || !accounts.has(t.inAccountId)) continue;
    if (t.outDate <= date && date < t.inDate) {
      const x = rate(t.currency);
      if (!x) return null;
      total = total.plus(t.amount.times(x));
    }
  }
  return total;
}

export function computeDays(
  snapshots: Snapshot[],
  flows: FlowAnalysis,
  fx: ReadonlyMap<string, string>,
  ccy: Ccy,
  bench: BenchmarkSeries,
): DayResult[] {
  const usable = [...snapshots].filter((s) => s.status === "ok").sort((a, b) => a.date.localeCompare(b.date));
  const out: DayResult[] = [];

  for (let i = 1; i < usable.length; i++) {
    const A = usable[i - 1]!;
    const B = usable[i]!;
    const base: DayResult = {
      date: B.date,
      prevDate: A.date,
      spans: Math.max(1, tradingDaysBetween(A.date, B.date)),
      status: "excluded",
      reason: null,
      r: null,
      b: null,
      coverage: null,
      valueEnd: null,
      benchmarkMarketClosed: !isMarketOpen(BENCHMARKS[bench.id].market, B.date),
      drivers: null,
    };
    const exclude = (reason: string): void => void out.push({ ...base, reason });

    const rateA = (c: string) => rateTo(fx, c, ccy, A.date);
    const rateB = (c: string) => rateTo(fx, c, ccy, B.date);

    const accounts = new Set(A.accountIds.filter((id) => B.accountIds.includes(id)));
    if (accounts.size === 0) {
      exclude("No account was connected on both days");
      continue;
    }
    const sa = side(A, accounts);
    const sb = side(B, accounts);
    // Priced at both ends: these get price and currency effects in "what moved you".
    const keys = [...sa.priced.keys()].filter((k) => sb.priced.has(k));
    // Present at both ends but unpriced at one: left out of BOTH ends so it can't fake a move.
    const presentA = new Set(sa.all.map(key));
    const presentB = new Set(sb.all.map(key));
    const dropped = new Set([
      ...[...sa.priced.keys()].filter((k) => presentB.has(k) && !sb.priced.has(k)),
      ...[...sb.priced.keys()].filter((k) => presentA.has(k) && !sa.priced.has(k)),
    ]);
    // Valued at each end: everything priced there, including holdings bought or sold out today.
    const keysA = [...sa.priced.keys()].filter((k) => !dropped.has(k));
    const keysB = [...sb.priced.keys()].filter((k) => !dropped.has(k));

    // Value at each end.
    const missing: { currency: string | null } = { currency: null };
    const valueOf = (s: Side, snap: Snapshot, rate: (c: string) => Dec | null, valued: string[]): Dec => {
      let v = ZERO;
      for (const k of valued) {
        const p = s.priced.get(k)!;
        const x = rate(p.currency);
        if (!x) {
          missing.currency = p.currency;
          continue;
        }
        v = v.plus(holdingValue(p, x));
      }
      for (const c of snap.cash) {
        if (!accounts.has(c.accountId)) continue;
        const x = rate(c.currency);
        const amt = dec(c.cash);
        if (!x || !amt) {
          missing.currency = c.currency;
          continue;
        }
        v = v.plus(amt.times(x));
      }
      return v;
    };
    const transitA = transitOn(A.date, flows, accounts, rateA);
    const transitB = transitOn(B.date, flows, accounts, rateB);
    const vA0 = valueOf(sa, A, rateA, keysA);
    const vB0 = valueOf(sb, B, rateB, keysB);
    if (missing.currency !== null || !transitA || !transitB) {
      const c = missing.currency;
      exclude(c === null || c === "CAD" || c === "USD" ? "No Bank of Canada rate for this date" : `Holding in unsupported currency ${c}`);
      continue;
    }
    const vA = vA0.plus(transitA);
    const vB = vB0.plus(transitB);

    // Coverage: valued amount ÷ (valued amount + what was left out at that end). A holding dropped
    // because one end had no price is measured by its value at the priced end (its true size);
    // anything unpriced at both ends falls back to cost basis.
    const leftOut = (s: Side, valued: string[]): Dec =>
      sum(
        s.all
          .filter((p) => !valued.includes(key(p)))
          .map((p) => {
            const k = key(p);
            if (dropped.has(k)) {
              const fromA = sa.priced.get(k);
              const row = fromA ?? sb.priced.get(k)!;
              const x = (fromA ? rateA : rateB)(row.currency);
              return x ? holdingValue(row, x).abs() : ZERO;
            }
            const cb = dec(p.costBasis);
            const x = (s === sa ? rateA : rateB)(p.currency);
            return cb && x ? cb.abs().times(x) : ZERO;
          }),
      );
    const covOf = (v: Dec, u: Dec) => (v.plus(u).isZero() ? ONE : v.div(v.plus(u)));
    const coverage = D.min(covOf(vA, leftOut(sa, keysA)), covOf(vB, leftOut(sb, keysB)));
    // Bought or sold out today but unpriced at the one end where it exists: its value can't be
    // counted, yet its cash side is, so any number would be invented.
    const unpricedOneSided = [...sa.all.filter((p) => !presentB.has(key(p)) && !sa.priced.has(key(p))), ...sb.all.filter((p) => !presentA.has(key(p)) && !sb.priced.has(key(p)))];
    base.coverage = coverage;
    base.valueEnd = vB;

    // Flows in (A, B].
    let flowSum = ZERO;
    let flowRateMissing = false;
    let unvalued = false;
    for (const f of flows.flows) {
      if (!accounts.has(f.accountId) || f.date <= A.date || f.date > B.date) continue;
      const x = rateTo(fx, f.currency, ccy, f.date);
      if (!x) flowRateMissing = true;
      else flowSum = flowSum.plus(f.amount.times(x));
    }
    // A transfer with only one side in the compared accounts moves money into or out of them.
    for (const t of flows.transits) {
      const outIn = accounts.has(t.outAccountId);
      const inIn = accounts.has(t.inAccountId);
      if (outIn === inIn) continue; // both compared (internal, handled by transit) or neither
      const date = outIn ? t.outDate : t.inDate;
      if (date <= A.date || date > B.date) continue;
      const x = rateTo(fx, t.currency, ccy, date);
      if (!x) flowRateMissing = true;
      else flowSum = flowSum.plus((outIn ? t.amount.neg() : t.amount).times(x));
    }
    for (const d of flows.unvaluedDates) if (d > A.date && d <= B.date) unvalued = true;

    if (flowRateMissing) exclude("No Bank of Canada rate for a deposit or withdrawal");
    else if (unvalued) exclude("A transferred-in asset has no cash value");
    else if (unpricedOneSided.length > 0) exclude(`${unpricedOneSided[0]!.ticker} was bought or sold this day but your broker gave no price for it`);
    else if (vA.lt(MIN_START_VALUE)) exclude("Portfolio value too small to measure");
    else if (coverage.lt(MIN_COVERAGE)) exclude("Less than 90% of holdings had prices");
    else {
      const r = vB.minus(flowSum).div(vA).minus(ONE);
      const provisional = B.transactionsSyncedMin === null || B.transactionsSyncedMin < B.date;
      out.push({
        ...base,
        status: provisional ? "provisional" : "ok",
        reason: provisional ? "Deposits for this day may not have synced yet" : null,
        r,
        b: benchmarkReturn(bench, fx, ccy, A.date, B.date),
        drivers: drivers(keys, sa, sb, A, accounts, rateA, rateB, vA, r),
      });
    }
  }
  return combineAcrossMissingBenchmark(out, bench, fx, ccy);
}

/**
 * A missing benchmark close (a failed capture) would leave both days that touch it without a market
 * return. Instead of guessing the price, combine those days into one comparison over the same span:
 * the user's returns compound, the market is measured from the last saved price before the gap to
 * the first one after it. Like a missed run, nothing is invented and both sides cover the same days.
 * A gap at the very start (no earlier price) or broken by an excluded day stays uncompared.
 */
function combineAcrossMissingBenchmark(days: DayResult[], bench: BenchmarkSeries, fx: ReadonlyMap<string, string>, ccy: Ccy): DayResult[] {
  const priced = (date: string) => dec(bench.prices.get(date)) !== null && rateTo(fx, bench.currency, ccy, date) !== null;
  const out: DayResult[] = [];
  let run: DayResult[] = [];
  const flush = () => {
    out.push(...run);
    run = [];
  };
  for (const d of days) {
    const measurable = d.status !== "excluded" && d.r !== null;
    if (!measurable || d.b !== null) {
      flush();
      out.push(d);
      continue;
    }
    run.push(d);
    if (!priced(d.date)) continue; // still inside the gap
    // The gap closes at d. Combine only if the run starts from a priced close.
    if (run.length >= 2 && priced(run[0]!.prevDate)) {
      const first = run[0]!;
      const r = run.reduce((acc, x) => acc.times(ONE.plus(x.r!)), ONE).minus(ONE);
      out.push({
        ...d,
        prevDate: first.prevDate,
        spans: run.reduce((n, x) => n + x.spans, 0),
        status: run.some((x) => x.status === "provisional") ? "provisional" : "ok",
        reason: run.some((x) => x.status === "provisional") ? "Deposits for this day may not have synced yet" : null,
        r,
        b: benchmarkReturn(bench, fx, ccy, first.prevDate, d.date),
        coverage: D.min(...run.map((x) => x.coverage ?? ONE)),
        drivers: null, // per-holding effects don't compound simply; the combined day shows totals only
        combinedOver: run.slice(0, -1).map((x) => x.date),
      });
      run = [];
    } else flush();
  }
  flush();
  return out;
}

export function benchmarkReturn(bench: BenchmarkSeries, fx: ReadonlyMap<string, string>, ccy: Ccy, from: string, to: string): Dec | null {
  const pA = dec(bench.prices.get(from));
  const pB = dec(bench.prices.get(to));
  const xA = rateTo(fx, bench.currency, ccy, from);
  const xB = rateTo(fx, bench.currency, ccy, to);
  if (!pA || !pB || !xA || !xB || pA.isZero()) return null;
  return pB.times(xB).div(pA.times(xA)).minus(ONE);
}

/**
 * Splits the day's return into each holding's price effect and currency effect:
 *   value change = u·m·(pB − pA)·xA  [price]  +  u·m·pB·(xB − xA)  [currency]
 * using start-of-day units; trades, flows and transfers land in the remainder.
 */
function drivers(
  keys: string[],
  sa: Side,
  sb: Side,
  A: Snapshot,
  accounts: ReadonlySet<string>,
  rateA: (c: string) => Dec | null,
  rateB: (c: string) => Dec | null,
  vA: Dec,
  r: Dec,
): DayResult["drivers"] {
  const holdings: HoldingEffect[] = [];
  for (const k of keys) {
    const a = sa.priced.get(k)!;
    const b = sb.priced.get(k)!;
    const xA = rateA(a.currency)!;
    const xB = rateB(a.currency)!;
    const um = dec(a.units)!.times(dec(a.multiplier) ?? ONE);
    holdings.push({
      ticker: a.ticker,
      priceEffect: um.times(dec(b.price)!.minus(dec(a.price)!)).times(xA).div(vA),
      currencyEffect: um.times(dec(b.price)!).times(xB.minus(xA)).div(vA),
    });
  }
  let cashCurrencyEffect = ZERO;
  for (const c of A.cash) {
    if (!accounts.has(c.accountId)) continue;
    const xA = rateA(c.currency);
    const xB = rateB(c.currency);
    const amt = dec(c.cash);
    if (xA && xB && amt) cashCurrencyEffect = cashCurrencyEffect.plus(amt.times(xB.minus(xA)).div(vA));
  }
  const explained = sum(holdings.map((h) => h.priceEffect.plus(h.currencyEffect))).plus(cashCurrencyEffect);
  return { holdings, cashCurrencyEffect, remainder: r.minus(explained) };
}
