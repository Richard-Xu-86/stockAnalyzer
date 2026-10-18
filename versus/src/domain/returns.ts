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
 * V = value of holdings priced at BOTH ends + cash + money in transit, in the reporting currency,
 * restricted to accounts present at both ends (an account added or removed is therefore neither
 * a gain nor a loss). F = external flows dated after the start and up to the end, assumed at day
 * end. Nothing is guessed: any missing input excludes the day with a stated reason.
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

function transitOn(date: string, flows: FlowAnalysis, ccy: Ccy, rate: (from: string) => Dec | null): Dec | null {
  let total = ZERO;
  for (const t of flows.transits) {
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
    const keys = [...sa.priced.keys()].filter((k) => sb.priced.has(k));

    // Value at each end over comparable holdings.
    const missing: { currency: string | null } = { currency: null };
    const valueOf = (s: Side, snap: Snapshot, rate: (c: string) => Dec | null): Dec => {
      let v = ZERO;
      for (const k of keys) {
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
    const transitA = transitOn(A.date, flows, ccy, rateA);
    const transitB = transitOn(B.date, flows, ccy, rateB);
    const vA0 = valueOf(sa, A, rateA);
    const vB0 = valueOf(sb, B, rateB);
    if (missing.currency !== null || !transitA || !transitB) {
      const c = missing.currency;
      exclude(c === null || c === "CAD" || c === "USD" ? "No Bank of Canada rate for this date" : `Holding in unsupported currency ${c}`);
      continue;
    }
    const vA = vA0.plus(transitA);
    const vB = vB0.plus(transitB);

    // Coverage: priced value ÷ (priced value + cost basis of holdings unpriced at either end).
    const unpricedCost = (s: Side, rate: (c: string) => Dec | null): Dec =>
      sum(
        s.all
          .filter((p) => !keys.includes(key(p)))
          .map((p) => {
            const cb = dec(p.costBasis);
            const x = rate(p.currency);
            return cb && x ? cb.abs().times(x) : ZERO;
          }),
      );
    const covOf = (v: Dec, u: Dec) => (v.plus(u).isZero() ? ONE : v.div(v.plus(u)));
    const coverage = D.min(covOf(vA, unpricedCost(sa, rateA)), covOf(vB, unpricedCost(sb, rateB)));
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
    for (const d of flows.unvaluedDates) if (d > A.date && d <= B.date) unvalued = true;

    if (flowRateMissing) exclude("No Bank of Canada rate for a deposit or withdrawal");
    else if (unvalued) exclude("A transferred-in asset has no cash value");
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
