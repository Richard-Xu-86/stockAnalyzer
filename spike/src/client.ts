import type { Config } from "./config.js";
import { AuthError, discover, refresh, type Discovery } from "./oauth.js";
import { loadTokens, saveTokens, toStored, type StoredTokens } from "./tokenStore.js";
import { decideRetry, sleep } from "./retry.js";

/** What we record about every call, for O1. Header values are kept only for rate-limit headers. */
export interface CallRecord {
  method: "GET";
  path: string; // template, e.g. /accounts/{id}/activities — never real IDs
  query: Record<string, string>;
  status: number;
  attempts: number;
  refreshedOn401: boolean;
  durationMs: number;
  rateLimitHeaders: Record<string, string>;
  otherHeaderNames: string[];
}

export interface ApiResult {
  status: number;
  body: unknown;
  record: CallRecord;
}

const HTTP_TIMEOUT_MS = 30_000;
// Spike budget: stay under SnapTrade's 10 req/min per-account limit (design doc uses 8).
const MIN_GAP_PER_ACCOUNT_MS = 60_000 / 8;

const RATE_LIMIT_HEADER = /^(x-ratelimit-|retry-after$)/i;

export class SnapTradeClient {
  private tokens: StoredTokens;
  private discovery: Discovery | undefined;
  private readonly lastCallAt = new Map<string, number>();
  // A 401 on one account can be account-specific, not an expired token. Refresh at most once
  // per run so a bad account cannot burn through rotating refresh tokens.
  private refreshedThisRun = false;
  readonly calls: CallRecord[] = [];

  constructor(private readonly cfg: Config, private readonly pace = true) {
    this.tokens = loadTokens();
  }

  /** `template` is logged; `path` is called. The account key paces per-account calls. */
  async get(template: string, path: string, query: Record<string, string> = {}, accountKey?: string): Promise<ApiResult> {
    if (this.pace && accountKey) await this.waitForAccountSlot(accountKey);
    const started = Date.now();
    let refreshedOn401 = false;
    for (let attempt = 1; ; attempt++) {
      const res = await this.send(path, query);
      if (res.status === 401 && !refreshedOn401 && !this.refreshedThisRun) {
        // Design rule: on 401, refresh once and retry once. A second 401 is final.
        this.refreshedThisRun = true;
        await this.refreshTokens();
        refreshedOn401 = true;
        attempt--; // the refresh retry does not count against the backoff budget
        continue;
      }
      const decision = decideRetry(attempt, res.status, res.headers.get("retry-after"));
      if (decision.retry) {
        await sleep(decision.delayMs);
        continue;
      }
      const record = this.record(template, query, res, attempt, refreshedOn401, Date.now() - started);
      return { status: res.status, body: await safeJson(res), record };
    }
  }

  async refreshTokens(): Promise<{ rotated: boolean; idTokenPresent: boolean }> {
    this.discovery ??= await discover(this.cfg);
    const previous = this.tokens.refreshToken;
    const next = await refresh(this.cfg, this.discovery, previous);
    this.tokens = toStored(next);
    saveTokens(this.tokens); // persist immediately: the old refresh token is now dead
    return { rotated: next.refresh_token !== previous, idTokenPresent: Boolean(next.id_token) };
  }

  private async send(path: string, query: Record<string, string>): Promise<Response> {
    const url = new URL(path, this.cfg.SNAPTRADE_API_BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    // Bearer only: no clientId, consumerKey, userId, userSecret, timestamp or signature.
    return fetch(url, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }

  private record(template: string, query: Record<string, string>, res: Response, attempts: number, refreshedOn401: boolean, durationMs: number): CallRecord {
    const rateLimitHeaders: Record<string, string> = {};
    const otherHeaderNames: string[] = [];
    res.headers.forEach((value, name) => {
      if (RATE_LIMIT_HEADER.test(name)) rateLimitHeaders[name.toLowerCase()] = value;
      else otherHeaderNames.push(name.toLowerCase());
    });
    const rec: CallRecord = { method: "GET", path: template, query, status: res.status, attempts, refreshedOn401, durationMs, rateLimitHeaders, otherHeaderNames: otherHeaderNames.sort() };
    this.calls.push(rec);
    return rec;
  }

  private async waitForAccountSlot(accountKey: string): Promise<void> {
    const last = this.lastCallAt.get(accountKey);
    if (last !== undefined) {
      const wait = last + MIN_GAP_PER_ACCOUNT_MS - Date.now();
      if (wait > 0) await sleep(wait);
    }
    this.lastCallAt.set(accountKey, Date.now());
  }
}

async function safeJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return { nonJsonBody: text.slice(0, 500) };
  }
}
