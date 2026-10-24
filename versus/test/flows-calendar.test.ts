import { describe, expect, it } from "vitest";
import { analyzeFlows } from "@/domain/flows";
import { dayOneHistory } from "@/domain/history";
import { closeDateFor, closeInstant, isCloseWindow, isMarketOpen, openInstant, tradingDaysBetween } from "@/lib/calendar";
import { act, near } from "./helpers";

describe("flow classification", () => {
  const accts = new Set(["a1", "a2"]);

  it("counts deposits, withdrawals, referrals and reimbursements; ignores dividends and interest", () => {
    const f = analyzeFlows(
      [
        act("1", "a1", "CONTRIBUTION", "2026-08-03", "100"),
        act("2", "a1", "WITHDRAWAL", "2026-08-04", "-40"),
        act("3", "a1", "REFERRAL", "2026-08-05", "25"),
        act("4", "a1", "REIMBURSEMENT", "2026-08-05", "5"),
        act("5", "a1", "DIVIDEND", "2026-08-05", "12"),
        act("6", "a1", "INTEREST", "2026-08-05", "1"),
      ],
      accts,
    );
    expect(f.flows.map((x) => [x.activityId, near(x.amount)])).toEqual([["1", "100"], ["2", "-40"], ["3", "25"], ["4", "5"]]);
  });

  it("matches transfers by amount within 7 days, and leaves others as external", () => {
    const f = analyzeFlows(
      [
        act("o1", "a1", "INTERNAL_CASH_TRANSFER_OUT", "2026-08-03", "-500"),
        act("i1", "a2", "INTERNAL_CASH_TRANSFER_IN", "2026-08-05", "500"),
        act("o2", "a1", "INTERNAL_CASH_TRANSFER_OUT", "2026-08-03", "-70"),
        act("i2", "a2", "INTERNAL_CASH_TRANSFER_IN", "2026-08-20", "70"), // too late to match
      ],
      accts,
    );
    expect(f.transits).toHaveLength(1);
    expect(f.transits[0]).toMatchObject({ outDate: "2026-08-03", inDate: "2026-08-05" });
    expect(f.flows.map((x) => [x.activityId, x.kind, near(x.amount)])).toEqual([["o2", "unmatched_transfer", "-70"], ["i2", "unmatched_transfer", "70"]]);
  });

  it("reads a generic TRANSFER's direction from its sign", () => {
    const f = analyzeFlows([act("t1", "a1", "TRANSFER", "2026-08-03", "250"), act("t2", "a1", "TRANSFER", "2026-08-04", "-75")], accts);
    expect(f.flows.map((x) => [x.activityId, near(x.amount)])).toEqual([["t1", "250"], ["t2", "-75"]]);
  });

  it("counts money moved in from an untracked account (e.g. chequing) as money in, in day-one history", () => {
    const acts = [
      act("c1", "a1", "CONTRIBUTION", "2026-07-02", "1000"),
      act("in1", "a1", "INTERNAL_CASH_TRANSFER_IN", "2026-07-10", "500"), // from chequing: no OUT leg in tracked accounts
      act("o1", "a1", "INTERNAL_CASH_TRANSFER_OUT", "2026-08-03", "-300"), // a1 → a2: matched, not money in
      act("i1", "a2", "INTERNAL_CASH_TRANSFER_IN", "2026-08-04", "300"),
      act("b1", "a1", "BUY", "2026-08-05", "-100"),
    ];
    const h = dayOneHistory(acts, analyzeFlows(acts, accts));
    expect(h.months.map((m) => [m.month, near(m.deposits.CAD), m.buys])).toEqual([["2026-07", "1500", 0], ["2026-08", undefined, 1]]);
    expect(near(h.netDeposits.CAD)).toBe("1500");
  });

  it("ignores activities from accounts that are not connected", () => {
    expect(analyzeFlows([act("1", "zz", "CONTRIBUTION", "2026-08-03", "100")], accts).flows).toHaveLength(0);
  });
});

describe("market calendar", () => {
  it("knows each market's holidays", () => {
    expect(isMarketOpen("TSX", "2026-07-01")).toBe(false); // Canada Day
    expect(isMarketOpen("NYSE", "2026-07-01")).toBe(true);
    expect(isMarketOpen("NYSE", "2026-07-03")).toBe(false); // July 4th observed
    expect(isMarketOpen("TSX", "2026-09-30")).toBe(true); // a Bank of Canada holiday, not a TSX one
    expect(isMarketOpen("NYSE", "2026-08-29")).toBe(false); // Saturday
  });

  it("puts the close at 16:00 New York time in both EDT and EST", () => {
    expect(closeInstant("2026-08-24").toISOString()).toBe("2026-08-24T20:00:00.000Z");
    expect(closeInstant("2026-12-14").toISOString()).toBe("2026-12-14T21:00:00.000Z");
    expect(openInstant("2026-08-24").toISOString()).toBe("2026-08-24T13:30:00.000Z");
  });

  it("only treats after-close, before-next-open as a close", () => {
    expect(isCloseWindow(new Date("2026-08-24T22:00:00Z"))).toBe(true); // 6 PM EDT Monday
    expect(closeDateFor(new Date("2026-08-24T22:00:00Z"))).toBe("2026-08-24");
    expect(isCloseWindow(new Date("2026-08-24T16:00:00Z"))).toBe(false); // noon: market open
    expect(closeDateFor(new Date("2026-08-29T15:00:00Z"))).toBe("2026-08-28"); // Saturday → Friday's close
    expect(isCloseWindow(new Date("2026-08-29T15:00:00Z"))).toBe(true);
    expect(isCloseWindow(new Date("2026-08-31T14:00:00Z"))).toBe(false); // Monday 10 AM: open again
    expect(isCloseWindow(new Date("2026-08-31T12:00:00Z"))).toBe(false); // Monday 8 AM: pre-market, not a close
    expect(isCloseWindow(new Date("2026-08-31T07:59:00Z"))).toBe(true); // Monday 3:59 AM: still Friday's close
    expect(isCloseWindow(new Date("2026-12-14T08:30:00Z"))).toBe(true); // Mon 3:30 AM EST (winter offset)
    expect(isCloseWindow(new Date("2026-12-14T09:30:00Z"))).toBe(false); // Mon 4:30 AM EST
  });

  it("counts trading days across a holiday", () => {
    expect(tradingDaysBetween("2026-06-30", "2026-07-06")).toBe(4); // Jul 1 (TSX closed but NYSE open), 2, 3 (NYSE closed, TSX open), 6
  });
});
