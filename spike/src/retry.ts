/**
 * Pure retry policy, shared by the SnapTrade and Bank of Canada clients.
 * SnapTrade's OAuth path can return 429 with no X-RateLimit headers at all
 * (per-user limit), so Retry-After wins, then exponential backoff with full jitter.
 */
export const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export type RetryDecision = { retry: false } | { retry: true; delayMs: number };

export function isRetryableStatus(status: number): boolean {
  // 503 is documented by SnapTrade as "connection busy syncing, safe to retry".
  return status === 429 || (status >= 500 && status <= 599);
}

/** Retry-After may be seconds or an HTTP date; anything else is ignored. */
export function parseRetryAfterMs(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), MAX_DELAY_MS);
}

export function decideRetry(
  attempt: number, // 1-based attempt that just failed
  status: number,
  retryAfter: string | null,
  random: () => number = Math.random,
): RetryDecision {
  if (!isRetryableStatus(status) || attempt >= MAX_ATTEMPTS) return { retry: false };
  const fromHeader = parseRetryAfterMs(retryAfter);
  if (fromHeader !== null) return { retry: true, delayMs: fromHeader };
  const cap = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return { retry: true, delayMs: Math.floor(random() * cap) };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
