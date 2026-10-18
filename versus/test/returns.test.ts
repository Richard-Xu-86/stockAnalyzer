import { describe, expect, it } from "vitest";
import { analyzeFlows } from "@/domain/flows";
import { computeDays } from "@/domain/returns";
import { computeMetrics } from "@/domain/metrics";
import { D } from "@/domain/decimal";
import { act, cash, near, pos, snap, spy, xic } from "./helpers";

const NO_FX = new Map<string, string>();
const flowsOf = (acts: ReturnType<typeof act>[], accounts = ["a1", "a2"]) => analyzeFlows(acts, new Set(accounts));

/*
 * Hand-computed fixture, all CAD, benchmark XIC.
 *  D1 Mon 08-24: X 10 × 100 = 1000, cash 1000                 V = 2000
 *  D2 Tue 08-25: X 10 × 110 = 1100, cash 1000                 V = 2100   r = 2100/2000 − 1 = 0.05
 *  D3 Wed 08-26: +500 deposit, cash 1500, X 1100              V = 2600   r = (2600 − 500)/2100 − 1 = 0
 *  D4 Thu 08-27: −300 withdrawal, cash 1200, X 10 × 99 = 990  V = 2190   r = (2190 + 300)/2600 − 1 = −0.0423076923…
 *  XIC 40 → 41 → 41 → 40.18:                                  b = 0.025, 0, −0.02
 *  Cumulative you = 1.05 × 1 × 2490/2600 − 1 = 0.0055769230…; market = 1.025 × 0.98 − 1 = 0.0045
 */
const fixture = () => {
  const snaps = [
    snap("2026-08-24", ["a1"], [pos("a1", "X", "10", "100")], [cash("a1", "1000")]),
    snap("2026-08-25", ["a1"], [pos("a1", "X", "10", "110")], [cash("a1", "1000")]),
    snap("2026-08-26", ["a1"], [pos("a1", "X", "10", "110")], [cash("a1", "1500")]),
    snap("2026-08-27", ["a1"], [pos("a1", "X", "10", "99")], [cash("a1", "1200")]),
  ];
  const acts = [act("dep", "a1", "CONTRIBUTION", "2026-08-26", "500"), act("wd", "a1", "WITHDRAWAL", "2026-08-27", "-300")];
  const bench = xic({ "2026-08-24": "40", "2026-08-25": "41", "2026-08-26": "41", "2026-08-27": "40.18" });
  return { snaps, acts, bench };
};

describe("daily returns (hand-computed)", () => {
  it("removes deposits and withdrawals exactly", () => {
    const { snaps, acts, bench } = fixture();
    const days = computeDays(snaps, flowsOf(acts), NO_FX, "CAD", bench);
    expect(days.map((d) => d.status)).toEqual(["ok", "ok", "ok"]);
    expect(days.map((d) => near(d.r))).toEqual(["0.05", "0", near(new D(2490).div(2600).minus(1))]);
    expect(days.map((d) => near(d.b))).toEqual(["0.025", "0", "-0.02"]);
  });

  it("compounds cumulative returns over the same days for both sides", () => {
    const { snaps, acts, bench } = fixture();
    const m = computeMetrics(computeDays(snaps, flowsOf(acts), NO_FX, "CAD", bench));
    expect(near(m.cumulativeYou)).toBe(near(new D("1.05").times(2490).div(2600).minus(1)));
    expect(near(m.cumulativeMarket)).toBe("0.0045");
    expect(m.comparableDays).toBe(3);
    expect(m.enoughForPatterns).toBe(false); // fewer than 10 days: no pattern metrics
    expect(m.beta).toBeNull();
    expect(m.earlyEstimate).toBe(true);
  });

  it("marks a day provisional when its activities have not synced", () => {
    const { snaps, acts, bench } = fixture();
    snaps[3] = { ...snaps[3]!, transactionsSyncedMin: "2026-08-26" };
    const last = computeDays(snaps, flowsOf(acts), NO_FX, "CAD", bench).at(-1)!;
    expect(last.status).toBe("provisional");
    expect(last.r).not.toBeNull();
  });

  it("spans a missed run and counts the trading days it covers", () => {
    const { snaps, acts, bench } = fixture();
    const days = computeDays([snaps[0]!, snaps[3]!], flowsOf(acts), NO_FX, "CAD", bench);
    expect(days).toHaveLength(1);
    expect(days[0]!.spans).toBe(3);
    // (2190 − (500 − 300)) / 2000 − 1 = −0.005
    expect(near(days[0]!.r)).toBe("-0.005");
    expect(near(days[0]!.b)).toBe(near(new D("40.18").div(40).minus(1)));
  });
});

describe("currency handling", () => {
  /*
   * USD stock in CAD reporting: 10 × 50 USD at 1.40 → 10 × 55 USD at 1.50.
   *  V1 = 700 CAD, V2 = 825 CAD, r = 825/700 − 1 = 0.1785714…
   *  price effect = 10 × 5 × 1.40 / 700 = 0.1; currency effect = 10 × 55 × 0.10 / 700 = 0.0785714…
   * In USD reporting the same day is simply 550/500 − 1 = 0.1 with no currency effect.
   */
  const snaps = [snap("2026-08-24", ["u1"], [pos("u1", "Y", "10", "50", "USD")], []), snap("2026-08-25", ["u1"], [pos("u1", "Y", "10", "55", "USD")], [])];
  const fx = new Map([["2026-08-24", "1.40"], ["2026-08-25", "1.50"]]);
  const bench = spy({ "2026-08-24": "600", "2026-08-25": "606" });

  it("reports in CAD with price and currency effects that sum to the return", () => {
    const [d] = computeDays(snaps, flowsOf([], ["u1"]), fx, "CAD", bench);
    expect(near(d!.r)).toBe(near(new D(825).div(700).minus(1)));
    const h = d!.drivers!.holdings[0]!;
    expect(near(h.priceEffect)).toBe("0.1");
    expect(near(h.currencyEffect)).toBe(near(new D(55).div(700)));
    expect(near(d!.drivers!.remainder)).toBe("0");
    // S&P in CAD terms: (606 × 1.5) / (600 × 1.4) − 1
    expect(near(d!.b)).toBe(near(new D(606 * 1.5).div(600 * 1.4).minus(1)));
  });

  it("reports the same day in USD", () => {
    const [d] = computeDays(snaps, flowsOf([], ["u1"]), fx, "USD", bench);
    expect(near(d!.r)).toBe("0.1");
    expect(near(d!.drivers!.holdings[0]!.currencyEffect)).toBe("0");
    expect(near(d!.b)).toBe("0.01");
  });

  it("excludes a day with no Bank of Canada rate within the lookback, instead of guessing", () => {
    const [d] = computeDays(snaps, flowsOf([], ["u1"]), new Map([["2026-08-10", "1.40"]]), "CAD", bench); // older than the 5-day lookback
    expect(d!.status).toBe("excluded");
    expect(d!.reason).toMatch(/Bank of Canada/);
  });

  it("uses the prior business day's rate on a Canadian holiday", () => {
    const s = [snap("2026-07-31", ["u1"], [pos("u1", "Y", "10", "50", "USD")], []), snap("2026-08-03", ["u1"], [pos("u1", "Y", "10", "55", "USD")], [])];
    const [d] = computeDays(s, flowsOf([], ["u1"]), new Map([["2026-07-31", "1.40"]]), "CAD", spy({ "2026-07-31": "600", "2026-08-03": "606" }));
    expect(near(d!.r)).toBe("0.1"); // same rate both ends (Aug 3 is the Civic Holiday)
  });
});

describe("transfers, account changes and coverage", () => {
  it("treats a matched transfer in transit as neither a loss nor a gain", () => {
    const s = [
      snap("2026-08-24", ["a1", "a2"], [], [cash("a1", "1000"), cash("a2", "0")]),
      snap("2026-08-25", ["a1", "a2"], [], [cash("a1", "600"), cash("a2", "0")]),
      snap("2026-08-26", ["a1", "a2"], [], [cash("a1", "600"), cash("a2", "400")]),
    ];
    const acts = [act("out", "a1", "INTERNAL_CASH_TRANSFER_OUT", "2026-08-25", "-400"), act("in", "a2", "INTERNAL_CASH_TRANSFER_IN", "2026-08-26", "400")];
    const days = computeDays(s, flowsOf(acts), NO_FX, "CAD", xic({}));
    expect(days.map((d) => near(d.r))).toEqual(["0", "0"]);
  });

  it("treats an unmatched transfer as money leaving the portfolio", () => {
    const s = [snap("2026-08-24", ["a1"], [], [cash("a1", "1000")]), snap("2026-08-25", ["a1"], [], [cash("a1", "600")])];
    const days = computeDays(s, flowsOf([act("out", "a1", "INTERNAL_CASH_TRANSFER_OUT", "2026-08-25", "-400")]), NO_FX, "CAD", xic({}));
    expect(near(days[0]!.r)).toBe("0");
  });

  it("ignores an account that appears mid-history, so its value is not a gain", () => {
    const s = [snap("2026-08-24", ["a1"], [], [cash("a1", "1000")]), snap("2026-08-25", ["a1", "a2"], [], [cash("a1", "1000"), cash("a2", "5000")])];
    const [d] = computeDays(s, flowsOf([]), NO_FX, "CAD", xic({}));
    expect(near(d!.r)).toBe("0");
  });

  it("computes on priced holdings while coverage stays at or above 90%", () => {
    // X priced both days; an option unpriced with cost basis 50: coverage = 1000/1050 ≈ 95%
    const opt = pos("a1", "OPT", "1", null, "CAD", { kind: "option", multiplier: "100", costBasis: "50" });
    const s = [snap("2026-08-24", ["a1"], [pos("a1", "X", "10", "100"), opt], []), snap("2026-08-25", ["a1"], [pos("a1", "X", "10", "105"), opt], [])];
    const [d] = computeDays(s, flowsOf([]), NO_FX, "CAD", xic({}));
    expect(d!.status).toBe("ok");
    expect(near(d!.r)).toBe("0.05");
    expect(near(d!.coverage, 6)).toBe(near(new D(1000).div(1050), 6));
  });

  it("excludes the day when coverage falls below 90%", () => {
    const opt = pos("a1", "OPT", "1", null, "CAD", { kind: "option", multiplier: "100", costBasis: "200" });
    const s = [snap("2026-08-24", ["a1"], [pos("a1", "X", "10", "100"), opt], []), snap("2026-08-25", ["a1"], [pos("a1", "X", "10", "105"), opt], [])];
    const [d] = computeDays(s, flowsOf([]), NO_FX, "CAD", xic({}));
    expect(d!.status).toBe("excluded");
    expect(d!.reason).toMatch(/90%/);
  });

  it("values options with the contract multiplier", () => {
    const o = (price: string) => pos("a1", "OPT", "2", price, "CAD", { kind: "option", multiplier: "100" });
    const s = [snap("2026-08-24", ["a1"], [o("1.50")], []), snap("2026-08-25", ["a1"], [o("1.80")], [])];
    const [d] = computeDays(s, flowsOf([]), NO_FX, "CAD", xic({}));
    expect(near(d!.valueEnd)).toBe("360"); // 2 × 1.80 × 100
    expect(near(d!.r)).toBe("0.2");
  });

  it("is unaffected by a stock split", () => {
    const s = [snap("2026-08-24", ["a1"], [pos("a1", "X", "10", "100")], []), snap("2026-08-25", ["a1"], [pos("a1", "X", "20", "50")], [])];
    expect(near(computeDays(s, flowsOf([]), NO_FX, "CAD", xic({}))[0]!.r)).toBe("0");
  });

  it("refuses to measure a tiny portfolio and skips stale snapshots", () => {
    const s = [snap("2026-08-24", ["a1"], [], [cash("a1", "50")]), snap("2026-08-25", ["a1"], [], [cash("a1", "60")])];
    expect(computeDays(s, flowsOf([]), NO_FX, "CAD", xic({}))[0]!.status).toBe("excluded");
    const stale = [snap("2026-08-24", ["a1"], [], [cash("a1", "1000")]), snap("2026-08-25", ["a1"], [], [cash("a1", "900")], { status: "stale" })];
    expect(computeDays(stale, flowsOf([]), NO_FX, "CAD", xic({}))).toHaveLength(0);
  });

  it("excludes a day containing an asset transferred in with no cash value", () => {
    const s = [snap("2026-08-24", ["a1"], [], [cash("a1", "1000")]), snap("2026-08-25", ["a1"], [], [cash("a1", "1000")])];
    const acts = [act("ext", "a1", "EXTERNAL_ASSET_TRANSFER_IN", "2026-08-25", null, null)];
    expect(computeDays(s, flowsOf(acts), NO_FX, "CAD", xic({}))[0]!.reason).toMatch(/no cash value/);
  });
});
