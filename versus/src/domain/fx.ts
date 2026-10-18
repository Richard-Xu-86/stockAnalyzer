import { addDays } from "@/lib/calendar";
import { FX_LOOKBACK_DAYS } from "@/lib/boc";
import { D, dec, type Dec } from "./decimal";
import type { Ccy, FxSeries } from "./types";

/** CAD per USD on `date`, else the most recent prior published day within the lookback. */
export function usdCadOn(fx: FxSeries, date: string): Dec | null {
  for (let back = 0; back <= FX_LOOKBACK_DAYS; back++) {
    const r = dec(fx.get(addDays(date, -back)));
    if (r) return r;
  }
  return null;
}

/**
 * Multiplier that converts one unit of `from` into the reporting currency on `date`.
 * Returns null when the currency is unsupported or no rate is available: callers must hold out, never guess.
 */
export function rateTo(fx: FxSeries, from: string, to: Ccy, date: string): Dec | null {
  if (from === to) return new D(1);
  if (from !== "CAD" && from !== "USD") return null;
  const usdCad = usdCadOn(fx, date);
  if (!usdCad) return null;
  return from === "USD" ? usdCad : new D(1).div(usdCad); // USD→CAD or CAD→USD
}
