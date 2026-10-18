import { z } from "zod";
import type { Config } from "./config.js";

const DiscoverySchema = z.object({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  revocation_endpoint: z.url().optional(),
  jwks_uri: z.url().optional(),
  scopes_supported: z.array(z.string()).optional(),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

// Fields we keep. The id_token is deliberately not part of the stored shape: the spike
// only checks for its presence (see probe:refresh), it never verifies or stores it.
export const TokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
  scope: z.string(),
  id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

const HTTP_TIMEOUT_MS = 15_000;

export async function discover(cfg: Config): Promise<Discovery> {
  const res = await fetch(`${cfg.SNAPTRADE_ISSUER}/.well-known/openid-configuration`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  return DiscoverySchema.parse(await res.json());
}

const basicAuth = (cfg: Config): string =>
  `Basic ${Buffer.from(`${cfg.SNAPTRADE_OAUTH_CLIENT_ID}:${cfg.SNAPTRADE_OAUTH_CLIENT_SECRET}`).toString("base64")}`;

async function postForm(cfg: Config, url: string, body: Record<string, string>): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: basicAuth(cfg),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

/** Thrown when the OAuth grant can no longer be used; the user must run `npm run login`. */
export class AuthError extends Error {}

const OAuthErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

/**
 * On failure, report only the standard OAuth `error` code and description (RFC 6749 §5.2),
 * never the raw body, which could echo a token.
 */
async function parseTokens(res: Response, step: string): Promise<TokenResponse> {
  if (!res.ok) {
    const parsed = OAuthErrorSchema.safeParse(await res.json().catch(() => null));
    const detail = parsed.success ? ` (${parsed.data.error}${parsed.data.error_description ? `: ${parsed.data.error_description.slice(0, 200)}` : ""})` : "";
    throw new AuthError(`${step} failed: HTTP ${res.status}${detail}`);
  }
  return TokenResponseSchema.parse(await res.json());
}

export async function exchangeCode(cfg: Config, d: Discovery, code: string, verifier: string) {
  const res = await postForm(cfg, d.token_endpoint, {
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    redirect_uri: cfg.SNAPTRADE_REDIRECT_URI,
  });
  return parseTokens(res, "Code exchange");
}

export async function refresh(cfg: Config, d: Discovery, refreshToken: string) {
  const res = await postForm(cfg, d.token_endpoint, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  return parseTokens(res, "Token refresh");
}

export async function revoke(cfg: Config, d: Discovery, refreshToken: string): Promise<number> {
  if (!d.revocation_endpoint) throw new Error("Discovery document has no revocation_endpoint.");
  const res = await postForm(cfg, d.revocation_endpoint, {
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  return res.status;
}
