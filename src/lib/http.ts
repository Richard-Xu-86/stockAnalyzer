import { timingSafeEqual } from "node:crypto";

/** Personal pages and responses must never be cached by a CDN or shared browser cache. */
export const PRIVATE = { "Cache-Control": "private, no-store" } as const;

/** CSRF defence in depth for form POSTs (cookies are also SameSite=Lax). */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Constant-time compare. */
export function isCronAuthorized(req: Request, secret: string): boolean {
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Relative redirect: the browser resolves it against the address it is already on. Building an
 * absolute URL from req.url can switch hosts (localhost vs 127.0.0.1 in dev), and cookies are per host.
 */
export const redirect303 = (_req: Request, path: string) => new Response(null, { status: 303, headers: { Location: path, "Cache-Control": "no-store" } });
