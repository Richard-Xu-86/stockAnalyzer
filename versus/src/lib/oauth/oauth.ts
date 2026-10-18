import { createHash, randomBytes } from "node:crypto";
import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import { AuthError } from "../snaptrade/client";

/** SnapTrade OAuth 2.0 authorization code + PKCE, plus OIDC ID-token verification. */
export const SCOPE = "openid email read";
const HTTP_TIMEOUT_MS = 15_000;

export interface OAuthConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

const DiscoverySchema = z.looseObject({
  issuer: z.string(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  revocation_endpoint: z.url().optional(),
  jwks_uri: z.url(),
});
export type Discovery = z.infer<typeof DiscoverySchema>;

const TokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  scope: z.string(),
  id_token: z.string().optional(),
});
export type TokenSet = z.infer<typeof TokenSchema>;

const OAuthErrorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const codeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

// Discovery is safe to cache per instance: losing it only costs one fetch.
let discoveryCache: { at: number; value: Discovery } | undefined;
const DISCOVERY_TTL_MS = 60 * 60_000;

export async function discover(cfg: OAuthConfig, fetchImpl: typeof fetch = fetch): Promise<Discovery> {
  if (discoveryCache && Date.now() - discoveryCache.at < DISCOVERY_TTL_MS) return discoveryCache.value;
  const res = await fetchImpl(`${cfg.issuer}/.well-known/openid-configuration`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
  const value = DiscoverySchema.parse(await res.json());
  discoveryCache = { at: Date.now(), value };
  return value;
}
export const _resetDiscoveryCache = () => {
  discoveryCache = undefined;
};

export function authorizeUrl(cfg: OAuthConfig, d: Discovery, p: { state: string; nonce: string; verifier: string }): string {
  const url = new URL(d.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", cfg.clientId);
  url.searchParams.set("redirect_uri", cfg.redirectUri);
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", p.state);
  url.searchParams.set("nonce", p.nonce);
  url.searchParams.set("code_challenge", codeChallenge(p.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function postForm(cfg: OAuthConfig, url: string, body: Record<string, string>, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
}

/** Errors carry only the standard OAuth `error` code (RFC 6749 §5.2), never the body. */
async function parseTokens(res: Response, step: string): Promise<TokenSet> {
  if (!res.ok) {
    const e = OAuthErrorSchema.safeParse(await res.json().catch(() => null));
    const msg = `${step} failed: HTTP ${res.status}${e.success ? ` (${e.data.error})` : ""}`;
    // Only 400/401 mean the grant itself is bad (invalid_grant, revoked). A 5xx or 429 is
    // SnapTrade having a bad moment: retry later rather than asking the user to sign in again.
    throw res.status === 400 || res.status === 401 ? new AuthError(msg) : new Error(msg);
  }
  return TokenSchema.parse(await res.json());
}

export async function exchangeCode(cfg: OAuthConfig, d: Discovery, code: string, verifier: string, fetchImpl: typeof fetch = fetch) {
  return parseTokens(await postForm(cfg, d.token_endpoint, { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: cfg.redirectUri }, fetchImpl), "Code exchange");
}

export async function refreshTokens(cfg: OAuthConfig, d: Discovery, refreshToken: string, fetchImpl: typeof fetch = fetch) {
  return parseTokens(await postForm(cfg, d.token_endpoint, { grant_type: "refresh_token", refresh_token: refreshToken }, fetchImpl), "Token refresh");
}

export async function revokeRefreshToken(cfg: OAuthConfig, d: Discovery, refreshToken: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!d.revocation_endpoint) return;
  await postForm(cfg, d.revocation_endpoint, { token: refreshToken, token_type_hint: "refresh_token" }, fetchImpl);
}

export interface VerifiedIdentity {
  sub: string;
  email: string | null;
  emailVerified: boolean;
}

let remoteJwks: { uri: string; set: JWTVerifyGetKey } | undefined;

/** Verifies signature (RS256 via JWKS, refetched on unknown kid), iss, aud, exp and nonce. */
export async function verifyIdToken(idToken: string, d: Discovery, clientId: string, nonce: string, keys?: Parameters<typeof createLocalJWKSet>[0]): Promise<VerifiedIdentity> {
  let getKey: JWTVerifyGetKey;
  if (keys) getKey = createLocalJWKSet(keys);
  else {
    if (remoteJwks?.uri !== d.jwks_uri) remoteJwks = { uri: d.jwks_uri, set: createRemoteJWKSet(new URL(d.jwks_uri)) };
    getKey = remoteJwks.set;
  }
  const { payload } = await jwtVerify(idToken, getKey, { issuer: d.issuer, audience: clientId, algorithms: ["RS256"] });
  if (payload.nonce !== nonce) throw new AuthError("ID token nonce mismatch");
  if (typeof payload.sub !== "string" || payload.sub === "") throw new AuthError("ID token has no subject");
  const emailVerified = payload.email_verified === true;
  return { sub: payload.sub, email: emailVerified && typeof payload.email === "string" ? payload.email : null, emailVerified };
}
