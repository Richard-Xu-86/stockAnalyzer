import { z } from "zod";
import type { RateSeries } from "./types.js";

/**
 * O3: parse a Valet observations response and answer coverage questions.
 * Expected shape (to be confirmed by the spike):
 *   { observations: [ { d: "2026-01-02", FXUSDCAD: { v: "1.3712" } }, ... ] }
 */
const ValetSchema = z.looseObject({
  observations: z.array(z.looseObject({ d: z.string() })),
});

export function parseValet(series: string, body: unknown): RateSeries {
  const parsed = ValetSchema.parse(body);
  const out: RateSeries = new Map();
  for (const obs of parsed.observations) {
    const cell = (obs as Record<string, unknown>)[series];
    const v = cell && typeof cell === "object" ? (cell as Record<string, unknown>).v : undefined;
    if (typeof v === "string" && v.trim() !== "") out.set(obs.d, v);
  }
  return out;
}

/** Days we may look back for a prior business day (covers long weekends plus holidays). */
export const MAX_LOOKBACK_DAYS = 5;

export interface RateLookup {
  rate: string;
  rateDate: string;
  substituted: boolean;
}

/** Rate for `date`, else the most recent earlier published day within MAX_LOOKBACK_DAYS. */
export function rateOnOrBefore(series: RateSeries, date: string): RateLookup | null {
  const d = new Date(`${date}T00:00:00Z`);
  for (let back = 0; back <= MAX_LOOKBACK_DAYS; back++) {
    const key = new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
    const rate = series.get(key);
    if (rate !== undefined) return { rate, rateDate: key, substituted: back > 0 };
  }
  return null;
}

export interface SeriesCoverage {
  series: string;
  observations: number;
  first: string | null;
  last: string | null;
  weekdayGaps: string[]; // weekdays with no rate: holidays or missing data
  weekendObservations: number; // expected 0
}

export function seriesCoverage(series: string, rates: RateSeries): SeriesCoverage {
  const dates = [...rates.keys()].sort();
  const first = dates[0] ?? null;
  const last = dates.at(-1) ?? null;
  const weekdayGaps: string[] = [];
  let weekendObservations = 0;
  for (const d of dates) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) weekendObservations++;
  }
  if (first && last) {
    for (let t = Date.parse(`${first}T00:00:00Z`); t <= Date.parse(`${last}T00:00:00Z`); t += 86_400_000) {
      const day = new Date(t);
      const dow = day.getUTCDay();
      const key = day.toISOString().slice(0, 10);
      if (dow !== 0 && dow !== 6 && !rates.has(key)) weekdayGaps.push(key);
    }
  }
  return { series, observations: dates.length, first, last, weekdayGaps, weekendObservations };
}
