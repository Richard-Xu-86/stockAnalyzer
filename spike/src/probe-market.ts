import { join } from "node:path";
import { loadConfig } from "./config.js";
import { SnapTradeClient } from "./client.js";
import { Scrubber } from "./scrub.js";
import { RAW_DIR, writeJson } from "./io.js";

/**
 * Market-data spike: can SnapTrade alone supply what a "you vs the market" view needs?
 *  1. /accounts/{id}/positions/all: are positions (including options) priced by the broker?
 *  2. /accounts/{id}/quotes: can we read benchmark ETF prices (SPY, XIU.TO, XIC.TO)?
 * One call each, on one investment account. Read-only.
 */
const BENCHMARKS = "SPY,XIU.TO,XIC.TO";

type Json = Record<string, unknown>;
const keysOf = (o: unknown) => (o && typeof o === "object" ? Object.keys(o as Json).sort() : []);

async function main(): Promise<void> {
  const cfg = loadConfig();
  const out = join(RAW_DIR, cfg.SPIKE_SCENARIO);
  const scrub = new Scrubber();
  const api = new SnapTradeClient(cfg);
  // Fetch real account IDs live: the saved accounts.json is scrubbed (IDs replaced by aliases),
  // so it cannot be used to address the API.
  const listed = await api.get("/accounts", "/accounts");
  if (listed.status !== 200 || !Array.isArray(listed.body)) throw new Error(`Listing accounts failed: HTTP ${listed.status}`);
  const accounts = listed.body as Json[];
  const investment = accounts.filter((a) => a.account_category === "INVESTMENT" && a.raw_type !== "CRYPTO");
  const summary: Json = {};

  for (const acct of investment) {
    const id = String(acct.id);
    const res = await api.get("/accounts/{id}/positions/all", `/accounts/${id}/positions/all`, {}, id);
    const results = Array.isArray((res.body as Json)?.results) ? ((res.body as Json).results as Json[]) : [];
    const byKind: Record<string, { count: number; positionFields: string[]; priced: number }> = {};
    for (const p of results) {
      const kind = String(((p.instrument as Json) ?? {}).kind ?? "unknown");
      const k = (byKind[kind] ??= { count: 0, positionFields: keysOf(p), priced: 0 });
      k.count++;
      const price = p.price ?? p.market_price ?? (p.market_value as unknown);
      if (price !== null && price !== undefined) k.priced++;
    }
    summary[`positions:${scrub.pseudonym(id)}:${acct.raw_type}`] = { status: res.status, byKind };
    writeJson(join(out, "positions-all", `${scrub.pseudonym(id)}.json`), scrub.scrub(res.body));
  }

  const first = investment[0];
  if (first) {
    const id = String(first.id);
    const q = await api.get("/accounts/{id}/quotes", `/accounts/${id}/quotes`, { symbols: BENCHMARKS, use_ticker: "true" }, id);
    const quotes = Array.isArray(q.body) ? (q.body as Json[]) : [];
    summary.quotes = {
      status: q.status,
      returned: quotes.map((x) => ({ ticker: (x.symbol as Json)?.symbol, fields: keysOf(x).filter((f) => f !== "symbol"), hasLast: x.last_trade_price !== null && x.last_trade_price !== undefined })),
      errorBody: q.status === 200 ? undefined : q.body,
    };
    writeJson(join(out, "quotes-probe.json"), q.body);
  }
  writeJson(join(out, "market-probe-summary.json"), summary);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
