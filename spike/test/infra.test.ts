import { describe, expect, it } from "vitest";
import { buildAuthorizeUrl, codeChallenge } from "../src/pkce.js";
import { parseEnvLine } from "../src/config.js";
import { decideRetry, parseRetryAfterMs, MAX_ATTEMPTS } from "../src/retry.js";
import { Scrubber } from "../src/scrub.js";
import { renderFindings } from "../src/findings.js";
import { ACCOUNTS, ACTIVITIES } from "./fixtures.js";

describe(".env parsing", () => {
  it.each([
    ['SNAPTRADE_OAUTH_CLIENT_SECRET=abc123', "abc123"],
    ['SNAPTRADE_OAUTH_CLIENT_SECRET = abc123  ', "abc123"],
    ['SNAPTRADE_OAUTH_CLIENT_SECRET="abc123"', "abc123"],
    ["SNAPTRADE_OAUTH_CLIENT_SECRET='abc123'\r", "abc123"],
    ['SNAPTRADE_OAUTH_CLIENT_SECRET=ab=c"d', 'ab=c"d'],
  ])("%j → %j", (line, expected) => {
    expect(parseEnvLine(line)).toEqual(["SNAPTRADE_OAUTH_CLIENT_SECRET", expected]);
  });

  it("ignores lines that are not assignments", () => {
    expect(parseEnvLine("just text")).toBeNull();
  });
});

describe("PKCE", () => {
  it("matches the RFC 7636 Appendix B test vector", () => {
    expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("builds an authorize URL with S256 and every required parameter", () => {
    const url = new URL(buildAuthorizeUrl({ authorizationEndpoint: "https://dashboard.snaptrade.com/oauth/authorize", clientId: "c", redirectUri: "http://127.0.0.1:3000/cb", scope: "openid email read", state: "s", nonce: "n", verifier: "v" }));
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: "code", client_id: "c", scope: "openid email read", state: "s", nonce: "n", code_challenge_method: "S256", code_challenge: codeChallenge("v") });
  });
});

describe("retry policy", () => {
  const noJitter = () => 1;

  it("honours Retry-After seconds and HTTP dates, capped", () => {
    expect(parseRetryAfterMs("7")).toBe(7000);
    expect(parseRetryAfterMs("999")).toBe(30_000);
    expect(parseRetryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(parseRetryAfterMs("soon")).toBeNull();
  });

  it("retries 429 and 5xx with backoff, never 4xx", () => {
    expect(decideRetry(1, 429, null, noJitter)).toEqual({ retry: true, delayMs: 1000 });
    expect(decideRetry(3, 503, null, noJitter)).toEqual({ retry: true, delayMs: 4000 });
    expect(decideRetry(1, 429, "2", noJitter)).toEqual({ retry: true, delayMs: 2000 });
    expect(decideRetry(1, 404, null)).toEqual({ retry: false });
    expect(decideRetry(MAX_ATTEMPTS, 429, "1")).toEqual({ retry: false });
  });
});

describe("scrubber", () => {
  it("pseudonymises IDs consistently and redacts personal fields", () => {
    const s = new Scrubber();
    const uuid = "917c8734-8470-4a3e-a18f-57c3f2ee6631";
    const out = s.scrub({
      accounts: [{ id: uuid, number: "Q6542138443", name: "Richard TFSA", institution_name: "Questrade", institution_account_id: "54953432" }],
      activity: { account: uuid, external_reference_id: "ref-x", description: "Paid to acct 123456789 for jane@example.com", currency: { code: "USD", name: "US Dollar" }, amount: -9.99 },
    }) as { accounts: Array<Record<string, unknown>>; activity: Record<string, unknown> };
    const [account] = out.accounts;
    expect(account).toMatchObject({ id: "id-0001", number: "REDACTED-NUMBER", name: "REDACTED-NAME", institution_name: "Questrade", institution_account_id: "id-0002" });
    expect(out.activity.account).toBe("id-0001"); // same UUID → same alias, joins survive
    expect(out.activity.description).toBe("Paid to acct #######89 for REDACTED-EMAIL");
    expect(out.activity.currency).toEqual({ code: "USD", name: "US Dollar" }); // public reference data kept
    expect(out.activity.amount).toBe(-9.99);
    expect(JSON.stringify(out)).not.toContain("Q6542138443");
  });
});

describe("FINDINGS.md renderer", () => {
  it("renders every open item even with no data, and is deterministic", () => {
    const empty = renderFindings([], { series: new Map(), statuses: [] }, "T");
    for (const h of ["O1.", "O2.", "O3.", "O4.", "O5.", "O6."]) expect(empty).toContain(`## ${h}`);
    expect(empty).toContain("Not verifiable from this data");
    const scenario = { scenario: "fixture", accounts: ACCOUNTS, activitiesByAccount: new Map([["a1", ACTIVITIES]]), rawActivities: ACTIVITIES, rawAccounts: ACCOUNTS, calls: [], rateLimitProbe: undefined, refreshProbe: { rotated: true, idTokenPresent: false } };
    const a = renderFindings([scenario], { series: new Map(), statuses: [] }, "T");
    expect(a).toBe(renderFindings([scenario], { series: new Map(), statuses: [] }, "T"));
    expect(a).toContain("refresh token rotated = true");
  });
});
