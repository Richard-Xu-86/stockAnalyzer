import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes → 43 base64url chars, the RFC 7636 recommended entropy. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/** S256 code challenge: base64url(sha256(verifier)), no padding. */
export const codeChallenge = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");

export interface AuthorizeParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  nonce: string;
  verifier: string;
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  const url = new URL(p.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("scope", p.scope);
  url.searchParams.set("state", p.state);
  url.searchParams.set("nonce", p.nonce);
  url.searchParams.set("code_challenge", codeChallenge(p.verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
