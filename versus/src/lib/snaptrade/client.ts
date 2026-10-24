import type { z } from "zod";
import { decideRetry, sleep } from "../retry";
import { log } from "../log";
import { AccountListSchema, ActivityPageSchema, BalanceListSchema, PositionsAllSchema, QuoteListSchema, type SnapActivity } from "./schemas";

/** The grant can no longer be used; the user must sign in again. */
export class AuthError extends Error {}
/** SnapTrade answered with a non-retryable error status. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}
/** A response did not match the shape the spike confirmed. Logged with the request ID, never coerced. */
export class SchemaDriftError extends Error {}

/** Supplies Bearer tokens. `refresh` is called at most once per client after a 401. */
export interface TokenProvider {
  accessToken(): Promise<string>;
  refresh(): Promise<string>;
}

/** Spaces out calls to one account across serverless instances (implemented on Postgres in prod). */
export interface Pacer {
  waitTurn(accountId: string): Promise<void>;
}

export const noPacing: Pacer = { waitTurn: async () => {} };

const HTTP_TIMEOUT_MS = 30_000;
const ACTIVITY_PAGE = 1000; // documented maximum

export class SnapTradeClient {
  private refreshed = false;

  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenProvider,
    private readonly pacer: Pacer = noPacing,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  listAccounts() {
    return this.get("/accounts", {}, undefined, AccountListSchema);
  }

  positions(accountId: string) {
    return this.get(`/accounts/${encodeURIComponent(accountId)}/positions/all`, {}, accountId, PositionsAllSchema);
  }

  balances(accountId: string) {
    return this.get(`/accounts/${encodeURIComponent(accountId)}/balances`, {}, accountId, BalanceListSchema);
  }

  /** All activities on or after `startDate` (YYYY-MM-DD), or full history when omitted. Paged. */
  async activities(accountId: string, startDate?: string): Promise<SnapActivity[]> {
    const all: SnapActivity[] = [];
    for (let offset = 0; ; offset += ACTIVITY_PAGE) {
      const query: Record<string, string> = { offset: String(offset), limit: String(ACTIVITY_PAGE) };
      if (startDate) query.startDate = startDate;
      const page = await this.get(`/accounts/${encodeURIComponent(accountId)}/activities`, query, accountId, ActivityPageSchema);
      all.push(...page.data);
      const total = page.pagination?.total ?? all.length;
      if (page.data.length === 0 || all.length >= total) return all;
    }
  }

  quotes(accountId: string, tickers: string[]) {
    return this.get(`/accounts/${encodeURIComponent(accountId)}/quotes`, { symbols: tickers.join(","), use_ticker: "true" }, accountId, QuoteListSchema);
  }

  private async get<S extends z.ZodType>(path: string, query: Record<string, string>, accountId: string | undefined, schema: S): Promise<z.infer<S>> {
    if (accountId) await this.pacer.waitTurn(accountId);
    // Join, never resolve: new URL("/accounts", ".../api/v1") would drop the /api/v1 prefix.
    const url = new URL(this.baseUrl.replace(/\/+$/, "") + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let token = await this.tokens.accessToken();
    for (let attempt = 1; ; attempt++) {
      const res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
      const requestId = res.headers.get("x-request-id") ?? undefined;
      if (res.status === 401) {
        // A 401 can be account-specific; refresh at most once per client so one bad
        // account can never burn through rotating refresh tokens (spike lesson).
        if (this.refreshed) {
          // The token was just renewed successfully, so a 401 on an account-scoped call is about
          // that account (e.g. its connection is broken), not the user's sign-in.
          if (accountId) throw new ApiError(`SnapTrade 401 on ${redactPath(path)} after refresh`, 401);
          throw new AuthError(`Unauthorized after refresh on ${redactPath(path)}`);
        }
        this.refreshed = true;
        token = await this.tokens.refresh();
        attempt--;
        continue;
      }
      const decision = decideRetry(attempt, res.status, res.headers.get("retry-after"));
      if (decision.retry) {
        log.warn("snaptrade retry", { path: redactPath(path), status: res.status, attempt, requestId });
        await sleep(decision.delayMs);
        continue;
      }
      if (!res.ok) throw new ApiError(`SnapTrade ${res.status} on ${redactPath(path)}`, res.status);
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        log.error("snaptrade schema drift", { path: redactPath(path), requestId, issues: parsed.error.issues.slice(0, 5).map((i) => i.path.join(".")) });
        throw new SchemaDriftError(`Unexpected response shape from ${redactPath(path)}`);
      }
      return parsed.data;
    }
  }
}

/** Account IDs are identifiers, not secrets, but keep logs free of them anyway. */
const redactPath = (path: string): string => path.replace(/\/accounts\/[^/]+/, "/accounts/{id}");
