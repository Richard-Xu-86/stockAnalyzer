import { z } from "zod";
import { decideRetry, sleep } from "./retry";

/**
 * Bank of Canada Valet API: daily USD/CAD (CAD per 1 USD). Verified in the spike: one value per
 * business day, no weekends, gaps on Canadian holidays.
 */
const ValetSchema = z.looseObject({ observations: z.array(z.looseObject({ d: z.string() })) });
export const USDCAD_SERIES = "FXUSDCAD";

export function parseValet(series: string, body: unknown): Map<string, string> {
  const out = new Map<string, string>();
  for (const obs of ValetSchema.parse(body).observations) {
    const cell = (obs as Record<string, unknown>)[series];
    const v = cell && typeof cell === "object" ? (cell as Record<string, unknown>).v : undefined;
    if (typeof v === "string" && v.trim() !== "") out.set(obs.d, v);
  }
  return out;
}

export async function fetchUsdCad(baseUrl: string, start: string, end: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const url = `${baseUrl}/observations/${USDCAD_SERIES}/json?start_date=${start}&end_date=${end}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const decision = decideRetry(attempt, res.status, res.headers.get("retry-after"));
    if (decision.retry) {
      await sleep(decision.delayMs);
      continue;
    }
    if (!res.ok) throw new Error(`Bank of Canada ${res.status}`);
    return parseValet(USDCAD_SERIES, await res.json());
  }
}

/** Days we look back for a prior business day (long weekends plus a holiday). */
export const FX_LOOKBACK_DAYS = 5;
