import { dec, Decimal } from "./decimal.js";
import { rateOnOrBefore } from "./o3-boc.js";
import type { Activity, RateSeries } from "./types.js";

/**
 * O4: does fx_rate appear, which way is it quoted, and how far is it from the BoC rate?
 * BoC FX{CCY}CAD is CAD per 1 unit of CCY. A broker may quote either way round, so we
 * test fx_rate and 1/fx_rate and keep the closer one; beyond 5% it is "not usable".
 */
export const SANITY_THRESHOLD = new Decimal("0.05"); // design doc: 5%

export type Orientation = "as_quoted" | "inverted";
export type FxVerdict =
  | { kind: "usable"; orientation: Orientation; deviation: string; rateDate: string; substituted: boolean }
  | { kind: "beyond_threshold"; bestDeviation: string }
  | { kind: "no_reference"; reason: string }
  | { kind: "invalid_rate" };

export interface FxRow {
  id: string;
  date: string | null;
  accountCurrency: string | null;
  securityCurrency: string | null;
  fxRate: string;
  verdict: FxVerdict;
}

const dateOf = (a: Activity): string | null => (a.trade_date ?? a.settlement_date)?.slice(0, 10) ?? null;

/** Picks the BoC series that prices the foreign side in CAD, if one side is CAD. */
function foreignCurrency(account: string | null, security: string | null): string | null {
  if (account === "CAD" && security && security !== "CAD") return security;
  if (security === "CAD" && account && account !== "CAD") return account;
  return null;
}

export type Judgement =
  | { kind: "usable"; orientation: Orientation; deviation: string }
  | { kind: "beyond_threshold"; bestDeviation: string }
  | { kind: "invalid_rate" };

/** Pure comparison of one broker rate with one reference rate. */
export function judgeFx(fxRate: Decimal, reference: Decimal): Judgement {
  if (fxRate.lte(0)) return { kind: "invalid_rate" };
  const devQuoted = fxRate.minus(reference).abs().div(reference);
  const devInverted = new Decimal(1).div(fxRate).minus(reference).abs().div(reference);
  const best = Decimal.min(devQuoted, devInverted);
  if (best.gt(SANITY_THRESHOLD)) return { kind: "beyond_threshold", bestDeviation: best.toFixed(4) };
  return { kind: "usable", orientation: devQuoted.lte(devInverted) ? "as_quoted" : "inverted", deviation: best.toFixed(4) };
}

export function analyzeFx(activities: Activity[], seriesByCurrency: Map<string, RateSeries>): FxRow[] {
  const rows: FxRow[] = [];
  for (const a of activities) {
    if (a.fx_rate === null || a.fx_rate === undefined) continue;
    const fx = dec(a.fx_rate);
    const date = dateOf(a);
    const accountCurrency = a.currency?.code ?? null;
    const securityCurrency = a.symbol?.currency?.code ?? null;
    const base = { id: a.id ?? "(no id)", date, accountCurrency, securityCurrency, fxRate: String(a.fx_rate) };
    if (!fx) {
      rows.push({ ...base, verdict: { kind: "invalid_rate" } });
      continue;
    }
    const foreign = foreignCurrency(accountCurrency, securityCurrency);
    const series = foreign ? seriesByCurrency.get(foreign) : undefined;
    if (!date || !foreign || !series) {
      const reason = !date ? "no date" : !foreign ? "pair does not involve CAD (or currencies match)" : `no BoC series loaded for ${foreign}`;
      rows.push({ ...base, verdict: { kind: "no_reference", reason } });
      continue;
    }
    const ref = rateOnOrBefore(series, date);
    const refDec = ref ? dec(ref.rate) : null;
    if (!ref || !refDec) {
      rows.push({ ...base, verdict: { kind: "no_reference", reason: `no BoC rate within lookback of ${date}` } });
      continue;
    }
    const verdict = judgeFx(fx, refDec);
    rows.push({ ...base, verdict: verdict.kind === "usable" ? { ...verdict, rateDate: ref.rateDate, substituted: ref.substituted } : verdict });
  }
  return rows;
}
