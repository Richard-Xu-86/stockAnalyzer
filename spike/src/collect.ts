import { join } from "node:path";
import { loadConfig } from "./config.js";
import { SnapTradeClient } from "./client.js";
import { Scrubber } from "./scrub.js";
import { RAW_DIR, writeJson } from "./io.js";
import { AuthError } from "./oauth.js";

/**
 * Pulls every endpoint the design relies on for the signed-in Sandbox user and writes
 * scrubbed responses to raw/<scenario>/. Read-only; Bearer token only.
 *
 *   npm run collect                   endpoints + activity paging/filter checks
 *   npm run probe:ratelimit           also bursts one account to observe a real 429 (O1)
 *   npm run probe:refresh             refreshes once: rotation, no id_token (setup check)
 */
const ACTIVITY_PAGE_SIZE = 1000; // documented maximum
const MAX_ACTIVITY_PAGES = 50; // safety stop for the spike, far above Sandbox volume
const RATE_LIMIT_BURST = 12; // documented per-account limit is 10/min

type Json = Record<string, unknown>;
const asArray = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const idOf = (o: Json): string | undefined => (typeof o.id === "string" ? o.id : undefined);

async function main(): Promise<void> {
  const cfg = loadConfig();
  const flags = new Set(process.argv.slice(2));
  const out = join(RAW_DIR, cfg.SPIKE_SCENARIO);
  const scrub = new Scrubber();
  const api = new SnapTradeClient(cfg);
  const save = (file: string, body: unknown) => writeJson(join(out, file), scrub.scrub(body));

  if (flags.has("--probe-refresh")) {
    const result = await api.refreshTokens();
    writeJson(join(out, "refresh-probe.json"), { ...result, at: new Date().toISOString() });
    console.log(`Refresh: rotated=${result.rotated}, id_token present=${result.idTokenPresent}`);
    return;
  }

  // O1: does the OAuth guide's GET /accounts work, and does the per-connection listing?
  const accountsFlat = await api.get("/accounts", "/accounts");
  save("accounts-flat.json", accountsFlat.body);

  const auths = await api.get("/authorizations", "/authorizations");
  save("authorizations.json", auths.body);

  const accounts = new Map<string, Json & { connectionId: string }>();
  for (const auth of asArray(auths.body)) {
    const authId = idOf(auth);
    if (!authId) continue;
    const res = await api.get("/authorizations/{id}/accounts", `/authorizations/${authId}/accounts`);
    for (const acct of asArray(res.body)) {
      const id = idOf(acct);
      if (id && !accounts.has(id)) accounts.set(id, { ...acct, connectionId: authId });
    }
  }
  // Fall back to the flat listing if the per-connection route is not available on this path.
  if (accounts.size === 0) {
    for (const acct of asArray(accountsFlat.body)) {
      const id = idOf(acct);
      if (id) accounts.set(id, { ...acct, connectionId: String(acct.brokerage_authorization ?? "unknown") });
    }
  }
  save("accounts.json", [...accounts.values()]);

  // The cost audit covers brokerage accounts only. DEPOSIT (cash/savings) and LOC (cards,
  // credit lines) are listed in accounts.json for O5 but not queried. Null category = unknown, kept.
  const SKIP_CATEGORIES = new Set(["DEPOSIT", "LOC"]);
  const investment = [...accounts].filter(([, a]) => !SKIP_CATEGORIES.has(String(a.account_category ?? "")));
  console.log(`Accounts found: ${accounts.size}; investment accounts to query: ${investment.length}`);

  const failures: Array<{ account: string; error: string }> = [];
  try {
    for (const [accountId] of investment) {
      const key = scrub.pseudonym(accountId);
      try {
        await collectAccount(accountId, key);
      } catch (err) {
        if (err instanceof AuthError) throw err; // grant unusable: every later call would fail too
        failures.push({ account: key, error: (err as Error).message });
        console.warn(`Account ${key}: ${(err as Error).message}; continuing.`);
      }
    }
  } finally {
    writeJson(join(out, "calls.json"), api.calls);
    writeJson(join(out, "failures.json"), failures);
  }

  async function collectAccount(accountId: string, key: string): Promise<void> {
    // /accounts/{id}/positions is deprecated and answered 410 on the OAuth path (spike O1);
    // the unified endpoint covers stocks, ETFs, options and crypto.
    const positions = await api.get("/accounts/{id}/positions/all", `/accounts/${accountId}/positions/all`, {}, accountId);
    save(join("positions", `${key}.json`), positions.body);
    const balances = await api.get("/accounts/{id}/balances", `/accounts/${accountId}/balances`, {}, accountId);
    save(join("balances", `${key}.json`), balances.body);

    const pages: unknown[] = [];
    for (let page = 0; page < MAX_ACTIVITY_PAGES; page++) {
      const res = await api.get("/accounts/{id}/activities", `/accounts/${accountId}/activities`, { offset: String(page * ACTIVITY_PAGE_SIZE), limit: String(ACTIVITY_PAGE_SIZE) }, accountId);
      pages.push(res.body);
      const body = (res.body ?? {}) as Json;
      const total = Number((body.pagination as Json | undefined)?.total ?? 0);
      if (res.status !== 200 || (page + 1) * ACTIVITY_PAGE_SIZE >= total) break;
    }
    save(join("activities", `${key}.json`), pages);

    // Filter checks: does `type` filtering and a date window behave as documented?
    const typed = await api.get("/accounts/{id}/activities", `/accounts/${accountId}/activities`, { type: "FEE,TAX,DIVIDEND" }, accountId);
    save(join("activities-filtered", `${key}.type.json`), typed.body);
    const recent = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
    const windowed = await api.get("/accounts/{id}/activities", `/accounts/${accountId}/activities`, { startDate: recent }, accountId);
    save(join("activities-filtered", `${key}.window.json`), windowed.body);
  }

  if (flags.has("--probe-rate-limit")) {
    const first = investment[0]?.[0];
    if (first) {
      const burst = new SnapTradeClient(cfg, false); // unpaced on purpose
      for (let i = 0; i < RATE_LIMIT_BURST; i++) {
        await burst.get("/accounts/{id}/balances", `/accounts/${first}/balances`, {}, first);
      }
      writeJson(join(out, "ratelimit-probe.json"), burst.calls);
      console.log(`Rate-limit probe statuses: ${burst.calls.map((c) => c.status).join(" ")}`);
    }
  }

  console.log(`Saved ${api.calls.length} calls to ${out}${failures.length ? ` (${failures.length} account(s) failed, see failures.json)` : ""}. Next: npm run boc && npm run analyze`);
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
