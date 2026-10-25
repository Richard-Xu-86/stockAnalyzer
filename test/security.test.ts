import { describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { newKey, open, parseKeyring, seal } from "@/lib/crypto";
import { authorizeUrl, codeChallenge, verifyIdToken, type Discovery } from "@/lib/oauth/oauth";
import { decideRetry, parseRetryAfterMs } from "@/lib/retry";
import { SnapTradeClient, noPacing } from "@/lib/snaptrade/client";
import { log } from "@/lib/log";

describe("token encryption", () => {
  it("round-trips, and decrypts old rows after a key rotation", () => {
    const k1 = newKey();
    const old = seal(parseKeyring(`k1:${k1}`, "k1"), "refresh-abc");
    const rotated = parseKeyring(`k1:${k1},k2:${newKey()}`, "k2");
    expect(open(rotated, old.keyId, old.sealed)).toBe("refresh-abc");
    expect(seal(rotated, "x").keyId).toBe("k2");
  });

  it("rejects tampered ciphertext", () => {
    const ring = parseKeyring(`k1:${newKey()}`, "k1");
    const { sealed } = seal(ring, "secret");
    sealed[sealed.length - 1]! ^= 1;
    expect(() => open(ring, "k1", sealed)).toThrow();
  });

  it("refuses short keys", () => {
    expect(() => parseKeyring(`k1:${Buffer.alloc(16).toString("base64")}`, "k1")).toThrow();
  });
});

describe("OAuth", () => {
  const d: Discovery = { issuer: "https://api.snaptrade.com", authorization_endpoint: "https://dashboard.snaptrade.com/oauth/authorize", token_endpoint: "https://api.snaptrade.com/oauth/token/", jwks_uri: "https://api.snaptrade.com/jwks" };
  const cfg = { issuer: d.issuer, clientId: "cid", clientSecret: "never-in-url", redirectUri: "https://versus.example/auth/callback" };

  it("builds a PKCE S256 authorize URL with read-only scope and no secret", () => {
    const u = new URL(authorizeUrl(cfg, d, { state: "st", nonce: "nn", verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" }));
    expect(u.searchParams.get("scope")).toBe("openid email read");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    // RFC 7636 appendix B test vector
    expect(u.searchParams.get("code_challenge")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(u.toString()).not.toContain("never-in-url");
  });

  const signed = async (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: string } = {}) => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256" };
    const token = await new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "k" }).setIssuer(opts.iss ?? d.issuer).setAudience(opts.aud ?? "cid").setIssuedAt().setExpirationTime(opts.exp ?? "5m").setSubject("user-123").sign(privateKey);
    return { token, keys: { keys: [jwk] } };
  };

  it("accepts a valid ID token and only trusts a verified email", async () => {
    const a = await signed({ nonce: "n1", email: "r@example.com", email_verified: true });
    expect(await verifyIdToken(a.token, d, "cid", "n1", a.keys)).toEqual({ sub: "user-123", email: "r@example.com", emailVerified: true });
    const b = await signed({ nonce: "n1", email: "r@example.com", email_verified: false });
    expect((await verifyIdToken(b.token, d, "cid", "n1", b.keys)).email).toBeNull();
  });

  it("rejects wrong nonce, issuer, audience, expiry and signature", async () => {
    const ok = await signed({ nonce: "n1" });
    await expect(verifyIdToken(ok.token, d, "cid", "other", ok.keys)).rejects.toThrow(/nonce/);
    const iss = await signed({ nonce: "n1" }, { iss: "https://evil.example" });
    await expect(verifyIdToken(iss.token, d, "cid", "n1", iss.keys)).rejects.toThrow();
    const aud = await signed({ nonce: "n1" }, { aud: "someone-else" });
    await expect(verifyIdToken(aud.token, d, "cid", "n1", aud.keys)).rejects.toThrow();
    const exp = await signed({ nonce: "n1" }, { exp: "-1m" });
    await expect(verifyIdToken(exp.token, d, "cid", "n1", exp.keys)).rejects.toThrow();
    const other = await signed({ nonce: "n1" });
    await expect(verifyIdToken(ok.token, d, "cid", "n1", other.keys)).rejects.toThrow();
  });
});

describe("retry policy", () => {
  it("honours Retry-After, backs off with jitter, and gives up", () => {
    expect(parseRetryAfterMs("2")).toBe(2000);
    expect(decideRetry(1, 429, "3")).toEqual({ retry: true, delayMs: 3000 });
    expect(decideRetry(1, 503, null, () => 0.5).retry).toBe(true);
    expect(decideRetry(4, 503, null).retry).toBe(false);
    expect(decideRetry(1, 404, null).retry).toBe(false);
  });
});

describe("activities paging", () => {
  it("pages 1000 at a time until the total is reached", async () => {
    const total = 2345;
    const seen: string[] = [];
    const f = (async (u: URL) => {
      const off = Number(u.searchParams.get("offset"));
      seen.push(u.searchParams.get("offset")!);
      const n = Math.max(0, Math.min(1000, total - off));
      return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ id: `a${off + i}`, type: "BUY" })), pagination: { total } }));
    }) as unknown as typeof fetch;
    const c = new SnapTradeClient("https://api.test", { accessToken: async () => "t", refresh: async () => "t" }, noPacing, f);
    expect(await c.activities("acc")).toHaveLength(total);
    expect(seen).toEqual(["0", "1000", "2000"]);
  });
});

describe("logging", () => {
  it("redacts tokens and money amounts", () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (l: string) => lines.push(l);
    try {
      log.info("x", { access_token: "abc", amount: 123.45, price: 9, userId: "u1" });
    } finally {
      console.log = orig;
    }
    expect(lines.join("")).not.toMatch(/abc|123\.45/);
    expect(lines.join("")).toContain("u1");
  });
});
