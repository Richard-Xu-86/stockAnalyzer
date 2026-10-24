import { ONE, ZERO, mean, sum, type Dec } from "./decimal";
import type { DayResult } from "./returns";

/**
 * Pattern metrics over days where both your return and the benchmark's exist.
 * Cumulative figures compound over the SAME days for both sides, so excluded days never favour
 * either one. Capture ratios use average daily returns (stated on screen).
 */
export const PATTERN_WINDOW = 30;
export const MIN_PATTERN_DAYS = 10;
export const EARLY_ESTIMATE_BELOW = 60;

export interface TrendPoint {
  date: string;
  you: Dec;
  market: Dec;
}

export interface Metrics {
  comparableDays: number;
  excludedDays: number;
  cumulativeYou: Dec | null;
  cumulativeMarket: Dec | null;
  trend: TrendPoint[];
  window: number;
  upCapture: Dec | null;
  downCapture: Dec | null;
  beta: Dec | null;
  hitRate: Dec | null;
  earlyEstimate: boolean;
  enoughForPatterns: boolean;
}

export const comparable = (days: DayResult[]) => days.filter((d) => d.status !== "excluded" && d.r !== null && d.b !== null) as Array<DayResult & { r: Dec; b: Dec }>;

export function computeMetrics(days: DayResult[]): Metrics {
  const pairs = comparable(days);
  const trend: TrendPoint[] = [];
  let you = ONE;
  let market = ONE;
  // The line starts at 0% on the close tracking is measured from, so one comparable day already
  // draws a segment instead of a lone point.
  if (pairs.length > 0) trend.push({ date: pairs[0]!.prevDate, you: ZERO, market: ZERO });
  for (const d of pairs) {
    you = you.times(ONE.plus(d.r));
    market = market.times(ONE.plus(d.b));
    trend.push({ date: d.date, you: you.minus(ONE), market: market.minus(ONE) });
  }
  const w = pairs.slice(-PATTERN_WINDOW);
  const enough = w.length >= MIN_PATTERN_DAYS;
  const ratio = (sel: (b: Dec) => boolean): Dec | null => {
    const days = w.filter((d) => sel(d.b));
    const mr = mean(days.map((d) => d.r));
    const mb = mean(days.map((d) => d.b));
    return enough && mr && mb && !mb.isZero() ? mr.div(mb) : null;
  };
  return {
    comparableDays: pairs.length,
    // Every day that is not in the totals, for any reason (bad data, or no market price for one
    // of its two closes), so the page can say how many were left out instead of dropping silently.
    excludedDays: days.length - pairs.length,
    cumulativeYou: pairs.length ? you.minus(ONE) : null,
    cumulativeMarket: pairs.length ? market.minus(ONE) : null,
    trend,
    window: w.length,
    upCapture: ratio((b) => b.gt(0)),
    downCapture: ratio((b) => b.lt(0)),
    beta: enough ? beta(w.map((d) => d.r), w.map((d) => d.b)) : null,
    hitRate: enough ? sum(w.map((d) => (d.r.gt(d.b) ? ONE : ZERO))).div(w.length) : null,
    earlyEstimate: pairs.length < EARLY_ESTIMATE_BELOW,
    enoughForPatterns: enough,
  };
}

/** Sample covariance(r, b) ÷ sample variance(b). Null when the benchmark never moved. */
export function beta(r: Dec[], b: Dec[]): Dec | null {
  const n = Math.min(r.length, b.length);
  if (n < 2) return null;
  const mr = mean(r.slice(0, n))!;
  const mb = mean(b.slice(0, n))!;
  let cov = ZERO;
  let varB = ZERO;
  for (let i = 0; i < n; i++) {
    const db = b[i]!.minus(mb);
    cov = cov.plus(r[i]!.minus(mr).times(db));
    varB = varB.plus(db.times(db));
  }
  return varB.isZero() ? null : cov.div(varB);
}
