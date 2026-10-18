import { describe, expect, it } from "vitest";
import { Decimal } from "../src/analyze/decimal.js";
import { analyzeCommissions, classifyTradeFee } from "../src/analyze/o2-commissions.js";
import { parseValet, rateOnOrBefore, seriesCoverage } from "../src/analyze/o3-boc.js";
import { analyzeFx, judgeFx } from "../src/analyze/o4-fx.js";
import { analyzeRawTypes, mapAccountType } from "../src/analyze/o5-account-types.js";
import { edgeCaseCoverage, summarise } from "../src/analyze/o6-coverage.js";
import { endpointSummary, fieldPresence, rateLimitObservation } from "../src/analyze/o1-fields.js";
import { ACCOUNTS, ACTIVITIES, USD_SERIES, act } from "./fixtures.js";

const byId = (id: string) => {
  const a = ACTIVITIES.find((x) => x.id === id);
  if (!a) throw new Error(`fixture ${id} missing`);
  return a;
};

describe("O1 field presence", () => {
  it("distinguishes missing keys, nulls and types", () => {
    const [fee, nested] = fieldPresence([{ fee: 1, a: { b: "x" } }, { fee: null }, {}], ["fee", "a.b"]);
    expect(fee).toEqual({ field: "fee", total: 3, missing: 1, nulls: 1, types: ["number"] });
    expect(nested).toEqual({ field: "a.b", total: 3, missing: 2, nulls: 0, types: ["string"] });
  });

  it("summarises endpoints and the rate-limit probe", () => {
    const row = (status: number, h: Record<string, string> = {}) => ({ path: "/accounts/{id}/balances", query: {}, status, attempts: 1, rateLimitHeaders: h, otherHeaderNames: [] });
    const probe = [row(200, { "x-ratelimit-account-remaining": "1" }), row(200, { "x-ratelimit-account-remaining": "0" }), row(429, { "retry-after": "7" })];
    expect(endpointSummary(probe)[0]?.statuses).toEqual([200, 429]);
    expect(rateLimitObservation(probe)).toEqual({ requests: 3, first429At: 3, retryAfterOn429: "7", accountRemainingSeen: ["1", "0", "-"] });
  });
});

describe("O2 commission placement", () => {
  it.each([
    ["buy-fee-in", "fee_in_amount"],
    ["sell-fee-in", "fee_in_amount"],
    ["buy-fee-out", "fee_not_in_amount"],
    ["buy-free", "no_fee"],
    ["buy-incomplete", "incomplete"],
  ] as const)("%s → %s", (id, expected) => {
    expect(classifyTradeFee(byId(id))).toBe(expected);
  });

  it("applies the option contract multiplier (100 standard, 10 mini)", () => {
    expect(classifyTradeFee(act({ id: "o", type: "BUY", units: 1, price: 0.61, fee: 0, amount: -61, option_symbol: { ticker: "X" } }))).toBe("no_fee");
    expect(classifyTradeFee(act({ id: "m", type: "BUY", units: 2, price: 1.5, fee: 0, amount: -30, option_symbol: { is_mini_option: true } }))).toBe("no_fee");
  });

  it("flags a trade whose cash cannot be explained by price, units and fee", () => {
    expect(classifyTradeFee(act({ id: "x", type: "BUY", units: 1, price: 10, fee: 1, amount: -15 }))).toBe("unexplained");
  });

  it("counts linked FEE rows and trades that would double-count", () => {
    const r = analyzeCommissions(ACTIVITIES);
    expect(r.tradesWithLinkedFeeRow).toBe(1);
    expect(r.tradesWithBothFeeAndLinkedRow).toBe(1);
    expect(r.trades.every((t) => t.type === "BUY" || t.type === "SELL")).toBe(true);
  });
});

describe("O3 Bank of Canada parsing", () => {
  const body = { observations: [{ d: "2026-03-06", FXUSDCAD: { v: "1.3700" } }, { d: "2026-03-09", FXUSDCAD: { v: "1.3780" } }, { d: "2026-03-10", FXUSDCAD: { v: "" } }] };

  it("keeps only published values", () => {
    expect([...parseValet("FXUSDCAD", body).entries()]).toEqual([["2026-03-06", "1.3700"], ["2026-03-09", "1.3780"]]);
  });

  it("rejects an unexpected shape loudly", () => {
    expect(() => parseValet("FXUSDCAD", { data: [] })).toThrow();
  });

  it("uses the prior business day on weekends and flags the substitution", () => {
    expect(rateOnOrBefore(USD_SERIES, "2026-03-08")).toEqual({ rate: "1.3700", rateDate: "2026-03-06", substituted: true });
    expect(rateOnOrBefore(USD_SERIES, "2026-03-09")).toEqual({ rate: "1.3780", rateDate: "2026-03-09", substituted: false });
  });

  it("gives up beyond the lookback window rather than reaching far back", () => {
    expect(rateOnOrBefore(USD_SERIES, "2026-03-20")).toBeNull();
  });

  it("reports weekday gaps and weekend observations", () => {
    const cov = seriesCoverage("FXUSDCAD", USD_SERIES);
    expect(cov.weekdayGaps).toEqual([]);
    expect(cov.weekendObservations).toBe(0);
    const withHoliday = new Map([["2026-03-05", "1"], ["2026-03-09", "1"]]);
    expect(seriesCoverage("FXUSDCAD", withHoliday).weekdayGaps).toEqual(["2026-03-06"]);
  });
});

describe("O4 FX orientation", () => {
  it("judges orientation and deviation exactly", () => {
    expect(judgeFx(new Decimal("1.37"), new Decimal("1.37"))).toEqual({ kind: "usable", orientation: "as_quoted", deviation: "0.0000" });
    expect(judgeFx(new Decimal("0.725"), new Decimal("1.378"))).toMatchObject({ kind: "usable", orientation: "inverted" });
    expect(judgeFx(new Decimal("2"), new Decimal("1.378")).kind).toBe("beyond_threshold");
    expect(judgeFx(new Decimal("0"), new Decimal("1.378")).kind).toBe("invalid_rate");
  });

  it("only analyses activities with fx_rate and records weekend substitution", () => {
    const rows = analyzeFx(ACTIVITIES, new Map([["USD", USD_SERIES]]));
    expect(rows.map((r) => r.id)).toEqual(["fx-sat", "fx-inv", "fx-bad"]);
    expect(rows[0]?.verdict).toEqual({ kind: "usable", orientation: "as_quoted", deviation: "0.0000", rateDate: "2026-03-06", substituted: true });
    expect(rows[1]?.verdict).toMatchObject({ kind: "usable", orientation: "inverted" });
    expect(rows[2]?.verdict.kind).toBe("beyond_threshold");
  });

  it("explains missing references instead of guessing", () => {
    const rows = analyzeFx(ACTIVITIES, new Map());
    expect(rows[0]?.verdict).toEqual({ kind: "no_reference", reason: "no BoC series loaded for USD" });
    const noCad = act({ id: "eur-usd", type: "BUY", fx_rate: 1.1, currency: { code: "EUR" }, symbol: { id: "s", currency: { code: "USD" } }, trade_date: "2026-03-09" });
    expect(analyzeFx([noCad], new Map([["USD", USD_SERIES]]))[0]?.verdict).toMatchObject({ kind: "no_reference" });
  });
});

describe("O5 account types", () => {
  it.each([
    ["TFSA", "tfsa"],
    ["Tax-Free Savings Account", "tfsa"],
    ["RRSP", "rrsp"],
    ["Spousal RRSP", "rrsp"],
    ["LIRA", "rrsp"],
    ["Margin", "taxable"],
    ["non_registered", "taxable"],
    ["RESP", "unknown"],
    ["", "unknown"],
  ] as const)("%s → %s", (raw, expected) => {
    expect(mapAccountType(raw)).toBe(expected);
  });

  it("groups accounts by institution and raw type", () => {
    expect(analyzeRawTypes(ACCOUNTS).map((r) => [r.rawType, r.mapped])).toEqual([["Margin", "taxable"], ["TFSA", "tfsa"]]);
  });
});

describe("O6 coverage", () => {
  it("summarises types, currencies and date range", () => {
    const s = summarise(ACCOUNTS, ACTIVITIES);
    expect(s.activityCount).toBe(ACTIVITIES.length);
    expect(s.currencies).toEqual(["CAD", "USD"]);
    expect(s.firstDate).toBe("2026-03-02");
    expect(s.byType.BUY).toBe(7);
  });

  it("maps each golden edge case to sandbox coverage", () => {
    const cov = Object.fromEntries(edgeCaseCoverage(ACTIVITIES, ACCOUNTS).map((e) => [e.id, e.coveredBySandbox]));
    expect(cov).toMatchObject({ C1: true, C2: true, C3: true, "C3-weekend": true, C4: true, C6: true, C7: false, C8: false, "C9-option": false, "C9-unknown": true, registered: true, dedupe: true });
  });
});
