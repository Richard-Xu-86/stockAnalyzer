import { describe, expect, it } from "vitest";
import { demoData } from "@/demo/sample";
import { buildDashboard } from "@/services/dashboard";
import { isCronAuthorized, isSameOrigin } from "@/lib/http";
import { pct, pts } from "@/ui/format";
import { D } from "@/domain/decimal";
import { cash, snap } from "./helpers";

describe("demo through the real engine", () => {
  const data = demoData();
  const combos = [["sp500", "CAD"], ["sp500", "USD"], ["tsx", "CAD"], ["tsx", "USD"]] as const;

  it.each(combos)("builds a complete dashboard for %s in %s", (benchmark, currency) => {
    const m = buildDashboard({ ...data, benchmarkPrices: data.benchmarks, benchmark, currency });
    expect(m.latest).not.toBeNull();
    expect(m.latest!.status).toBe("provisional"); // the demo's last day is unsynced on purpose
    expect(m.metrics.comparableDays).toBeGreaterThanOrEqual(30);
    expect(m.metrics.enoughForPatterns).toBe(true);
    expect(m.recentDays.some((d) => d.spans > 1)).toBe(true); // the missed run
    expect(m.dayOne.months.length).toBeGreaterThan(0);
    // drivers add up to the day's return
    const total = m.drivers.reduce((s, l) => s.plus(l.effect), new D(0));
    expect(total.minus(m.latest!.r!).abs().lt("1e-12")).toBe(true);
  });

  it("changing benchmark or currency changes the numbers", () => {
    const a = buildDashboard({ ...data, benchmarkPrices: data.benchmarks, benchmark: "sp500", currency: "CAD" });
    const b = buildDashboard({ ...data, benchmarkPrices: data.benchmarks, benchmark: "tsx", currency: "CAD" });
    const c = buildDashboard({ ...data, benchmarkPrices: data.benchmarks, benchmark: "sp500", currency: "USD" });
    expect(a.latest!.b!.eq(b.latest!.b!)).toBe(false);
    expect(a.latest!.r!.eq(c.latest!.r!)).toBe(false);
  });

  it("is deterministic", () => {
    const a = buildDashboard({ ...data, benchmarkPrices: data.benchmarks, benchmark: "tsx", currency: "USD" });
    const b = buildDashboard({ ...demoData(), benchmarkPrices: demoData().benchmarks, benchmark: "tsx", currency: "USD" });
    expect(pct(a.metrics.cumulativeYou)).toBe(pct(b.metrics.cumulativeYou));
  });
});

describe("formatting", () => {
  it("signs every figure with a real minus and never shows −0", () => {
    expect(pct(new D("-0.0123"))).toBe("−1.23%");
    expect(pct(new D("0.00001"))).toBe("0.00%");
    expect(pts(new D("0.0035"))).toBe("+0.35 pts");
    expect(pct(null)).toBe("–");
  });
});

describe("route guards", () => {
  const req = (h: Record<string, string>) => new Request("https://versus.example/api/x", { method: "POST", headers: h });

  it("accepts only same-origin form posts", () => {
    expect(isSameOrigin(req({ origin: "https://versus.example", host: "versus.example" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "versus.example" }))).toBe(false);
    expect(isSameOrigin(req({ host: "versus.example" }))).toBe(false);
  });

  it("requires the exact cron secret", () => {
    expect(isCronAuthorized(req({ authorization: "Bearer s3cret-s3cret-s3cret" }), "s3cret-s3cret-s3cret")).toBe(true);
    expect(isCronAuthorized(req({ authorization: "Bearer wrong" }), "s3cret-s3cret-s3cret")).toBe(false);
    expect(isCronAuthorized(req({}), "s3cret-s3cret-s3cret")).toBe(false);
  });
});

describe("real-week regressions (Oct 16-23)", () => {
  // First snapshot Friday Oct 16 with no market price that day; the broker is one day behind at
  // every 6 PM snapshot, as Wealthsimple was.
  const dates = ["2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"];
  const prev: Record<string, string> = { "2026-10-16": "2026-10-15", "2026-10-19": "2026-10-16", "2026-10-20": "2026-10-19", "2026-10-21": "2026-10-20" };
  const snaps = dates.map((d, i) => snap(d, ["a1"], [], [cash("a1", String(1000 + i * 10), "USD")], { transactionsSyncedMin: prev[d]! }));
  const spy = new Map([["2026-10-19", "600"], ["2026-10-20", "606"], ["2026-10-21", "603"]]); // no Oct 16
  const input = { snapshots: snaps, activities: [], fx: new Map([["2026-10-21", "1.38"]]), benchmarkPrices: { sp500: spy, tsx: new Map<string, string>() }, benchmark: "sp500" as const, currency: "USD" as const };

  it("settles past days once the broker has caught up, leaving only the latest provisional", () => {
    const stuck = buildDashboard(input);
    expect(stuck.recentDays.every((d) => d.status === "provisional")).toBe(true); // the bug, without current sync info
    const m = buildDashboard({ ...input, transactionsSyncedNow: "2026-10-20" });
    expect(m.recentDays.map((d) => [d.date, d.status])).toEqual([
      ["2026-10-21", "provisional"], // broker not yet through the 21st
      ["2026-10-20", "ok"],
      ["2026-10-19", "ok"],
    ]);
  });

  it("dates 'since you started tracking' from the first comparable close, not the first snapshot", () => {
    const m = buildDashboard({ ...input, transactionsSyncedNow: "2026-10-21" });
    expect(m.metrics.trend[0]!.date).toBe("2026-10-19");
    expect(m.trackingSince).toBe("2026-10-19");
  });

  it("falls back to the first snapshot before any comparison exists", () => {
    const m = buildDashboard({ ...input, snapshots: snaps.slice(0, 1) });
    expect(m.trackingSince).toBe("2026-10-16");
  });
});
