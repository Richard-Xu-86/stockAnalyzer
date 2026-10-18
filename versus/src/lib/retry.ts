/**
 * Retry policy shared by every outbound client (carried over from the spike, where it was tested).
 * SnapTrade's OAuth path can return 429 with no X-RateLimit headers, so Retry-After wins,
 * then exponential backoff with full jitter.
 */
export const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

export type RetryDecision = { retry: false } | { retry: true; delayMs: number };

export const isRetryableStatus = (status: number): boolean => status === 429 || (status >= 500 && status <= 599);

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | null {
  if (header === null || header.trim() === "") return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_DELAY_MS);
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(date - now, 0), MAX_DELAY_MS);
}

export function decideRetry(attempt: number, status: number, retryAfter: string | null, random: () => number = Math.random): RetryDecision {
  if (!isRetryableStatus(status) || attempt >= MAX_ATTEMPTS) return { retry: false };
  const fromHeader = parseRetryAfterMs(retryAfter);
  if (fromHeader !== null) return { retry: true, delayMs: fromHeader };
  const cap = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  return { retry: true, delayMs: Math.floor(random() * cap) };
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
