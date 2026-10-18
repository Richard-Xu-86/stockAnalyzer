import { join } from "node:path";
import { RAW_DIR, writeJson } from "./io.js";
import { decideRetry, sleep } from "./retry.js";

/**
 * O3: fetch Bank of Canada daily rates from the Valet API and save them raw.
 * URL pattern is the one to confirm in this spike:
 *   https://www.bankofcanada.ca/valet/observations/{SERIES}/json?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 *
 *   npm run boc -- [startDate] [endDate] [SERIES,SERIES]
 */
const VALET_BASE = "https://www.bankofcanada.ca/valet";
const DEFAULT_SERIES = ["FXUSDCAD", "FXEURCAD", "FXGBPCAD"];
const DEFAULT_LOOKBACK_DAYS = 120;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

async function fetchSeries(series: string, start: string, end: string): Promise<{ status: number; body: unknown }> {
  const url = `${VALET_BASE}/observations/${encodeURIComponent(series)}/json?start_date=${start}&end_date=${end}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    const decision = decideRetry(attempt, res.status, res.headers.get("retry-after"));
    if (decision.retry) {
      await sleep(decision.delayMs);
      continue;
    }
    return { status: res.status, body: res.ok ? await res.json() : await res.text() };
  }
}

async function main(): Promise<void> {
  const [startArg, endArg, seriesArg] = process.argv.slice(2);
  const end = endArg ?? new Date().toISOString().slice(0, 10);
  const start = startArg ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) throw new Error("Dates must be YYYY-MM-DD.");
  const series = seriesArg ? seriesArg.split(",") : DEFAULT_SERIES;

  for (const s of series) {
    const { status, body } = await fetchSeries(s, start, end);
    writeJson(join(RAW_DIR, "boc", `${s}.json`), { requested: { start, end }, status, body });
    console.log(`${s}: HTTP ${status}`);
  }
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
