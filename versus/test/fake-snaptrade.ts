/**
 * An in-memory SnapTrade + Bank of Canada, shaped like the responses the spike recorded.
 * Tests mutate `state` to script outages, token rotation and new activity.
 */
export const ISSUER = "https://api.snaptrade.test";
export const API = "https://api.snaptrade.test/api/v1";
export const BOC = "https://boc.test/valet";

export interface FakeState {
  accessToken: string;
  refreshToken: string;
  refreshCount: number;
  accounts: Array<{ id: string; category: string; raw_type: string; lastSync: string | null }>;
  positions: Record<string, Array<{ symbol: string; units: number; price: number | null; currency: string; kind?: string }>>;
  cash: Record<string, Array<{ code: string; cash: number }>>;
  activities: Record<string, Array<{ id: string; type: string; trade_date: string; amount: number; currency: string }>>;
  quotes: Record<string, number>;
  usdcad: Record<string, string>;
  asOf: string;
  /** Scripted failures: path substring → statuses returned in order before succeeding. */
  failures: Array<{ match: string; statuses: number[] }>;
  calls: string[];
}

export function fakeState(): FakeState {
  return {
    accessToken: "at-1",
    refreshToken: "rt-1",
    refreshCount: 0,
    accounts: [
      { id: "tfsa", category: "INVESTMENT", raw_type: "TFSA", lastSync: "2026-08-24" },
      { id: "chequing", category: "DEPOSIT", raw_type: "MSB", lastSync: "2026-08-24" },
    ],
    positions: { tfsa: [{ symbol: "XEQT.TO", units: 100, price: 35, currency: "CAD" }] },
    cash: { tfsa: [{ code: "CAD", cash: 500 }] },
    activities: { tfsa: [{ id: "d1", type: "CONTRIBUTION", trade_date: "2026-08-03T00:00:00Z", amount: 4000, currency: "CAD" }] },
    quotes: { SPY: 640.12, "XIC.TO": 41.5 },
    usdcad: { "2026-08-21": "1.3810", "2026-08-24": "1.3790" },
    asOf: "2026-08-24T22:00:05Z",
    failures: [],
    calls: [],
  };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export function fakeFetch(s: FakeState): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname;
    s.calls.push(`${init?.method ?? "GET"} ${path}`);

    const scripted = s.failures.find((f) => path.includes(f.match) && f.statuses.length > 0);
    if (scripted) {
      const status = scripted.statuses.shift()!;
      return json({ detail: "scripted" }, status, status === 429 ? { "retry-after": "0" } : {});
    }

    if (url.hostname === "boc.test") {
      return json({ observations: Object.entries(s.usdcad).map(([d, v]) => ({ d, FXUSDCAD: { v } })) });
    }
    if (path === "/.well-known/openid-configuration") {
      return json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/oauth/authorize`, token_endpoint: `${ISSUER}/oauth/token/`, revocation_endpoint: `${ISSUER}/oauth/revoke/`, jwks_uri: `${ISSUER}/jwks` });
    }
    if (path === "/oauth/token/") {
      const body = new URLSearchParams(String(init?.body));
      if (body.get("grant_type") === "refresh_token") {
        if (body.get("refresh_token") !== s.refreshToken) return json({ error: "invalid_grant" }, 400);
        s.refreshCount++;
        s.accessToken = `at-${s.refreshCount + 1}`;
        s.refreshToken = `rt-${s.refreshCount + 1}`; // rotation: the old one is now dead
        return json({ access_token: s.accessToken, refresh_token: s.refreshToken, expires_in: 36000, scope: "openid email read" });
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }

    const auth = new Headers(init?.headers).get("authorization");
    if (auth !== `Bearer ${s.accessToken}`) return json({ detail: "unauthorized" }, 401);

    if (path === "/api/v1/accounts") {
      return json(s.accounts.map((a) => ({ id: a.id, brokerage_authorization: "conn-1", institution_name: "Wealthsimple", name: a.raw_type, raw_type: a.raw_type, account_category: a.category, sync_status: { transactions: { last_successful_sync: a.lastSync, initial_sync_completed: true } } })));
    }
    const m = path.match(/^\/api\/v1\/accounts\/([^/]+)\/(.+)$/);
    if (m) {
      const [, id, rest] = m as unknown as [string, string, string];
      if (rest === "positions/all") {
        return json({ data_freshness: { as_of: s.asOf }, results: (s.positions[id] ?? []).map((p) => ({ instrument: { kind: p.kind ?? "stock", id: `i-${p.symbol}`, symbol: p.symbol, currency: p.currency }, units: String(p.units), price: p.price === null ? null : String(p.price), cost_basis: null, currency: p.currency })) });
      }
      if (rest === "balances") return json((s.cash[id] ?? []).map((c) => ({ currency: { code: c.code }, cash: c.cash })));
      if (rest === "activities") {
        const from = url.searchParams.get("startDate");
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 1000);
        const all = (s.activities[id] ?? []).filter((a) => !from || a.trade_date.slice(0, 10) >= from).map((a) => ({ ...a, currency: { code: a.currency } }));
        return json({ data: all.slice(offset, offset + limit), pagination: { offset, limit, total: all.length } });
      }
      if (rest === "quotes") {
        const syms = (url.searchParams.get("symbols") ?? "").split(",");
        return json(syms.filter((x) => x in s.quotes).map((x) => ({ symbol: { symbol: x, currency: { code: x === "SPY" ? "USD" : "CAD" } }, last_trade_price: s.quotes[x] })));
      }
    }
    return json({ detail: "not found" }, 404);
  }) as typeof fetch;
}
