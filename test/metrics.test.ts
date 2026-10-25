import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { D, ONE } from "@/domain/decimal";
import { beta, computeMetrics } from "@/domain/metrics";
import type { DayResult } from "@/domain/returns";
import { analyzeFlows } from "@/domain/flows";
import { computeDays } from "@/domain/returns";
import { act, cash, near, snap, xic } from "./helpers";

const day = (i: number, r: string, b: string): DayResult => ({
  date: `2026-07-${String(i + 1).padStart(2, "0")}`,
  prevDate: "",
  spans: 1,
  status: "ok",
  reason: null,
  r: new D(r),
  b: new D(b),
  coverage: ONE,
  valueEnd: null,
  benchmarkMarketClosed: false,
  drivers: null,
});

describe("pattern metrics", () => {
  // Benchmark alternates ±1%, ±2%; you move exactly twice as much.
  const bs = ["0.01", "-0.01", "0.02", "-0.02", "0.01", "-0.01", "0.02", "-0.02", "0.01", "-0.01", "0.02", "-0.02"];
  const days = bs.map((b, i) => day(i, new D(b).times(2).toString(), b));

  it("gives beta 2, capture ratios 2 and hit rate 50% for a portfolio that doubles every move", () => {
    const m = computeMetrics(days);
    expect(near(m.beta)).toBe("2");
    expect(near(m.upCapture)).toBe("2");
    expect(near(m.downCapture)).toBe("2");
    expect(near(m.hitRate)).toBe("0.5"); // beats on up days, lags on down days
    expect(m.enoughForPatterns).toBe(true);
    expect(m.earlyEstimate).toBe(true); // 12 days < 60
  });

  it("returns null beta when the benchmark never moved", () => {
    expect(beta([new D("0.01"), new D("0.02")], [new D(0), new D(0)])).toBeNull();
  });

  it("uses only the last 30 comparable days for patterns", () => {
    const many = Array.from({ length: 45 }, (_, i) => day(i % 28, i < 15 ? "0.03" : "0.01", i % 2 ? "0.01" : "-0.01"));
    expect(computeMetrics(many).window).toBe(30);
  });
});

describe("properties", () => {
  // Random cash-only portfolios with random deposits: a deposit must never change the return.
  it("a deposit matched by the same cash increase leaves the daily return unchanged", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1_000, max: 1_000_000 }), fc.integer({ min: -200, max: 200 }), fc.integer({ min: 1, max: 50_000 }), (start, moveBp, deposit) => {
        const end = new D(start).times(new D(1).plus(new D(moveBp).div(10_000)));
        const base = [snap("2026-08-24", ["a1"], [], [cash("a1", String(start))]), snap("2026-08-25", ["a1"], [], [cash("a1", end.toString())])];
        const withDep = [base[0]!, snap("2026-08-25", ["a1"], [], [cash("a1", end.plus(deposit).toString())])];
        const r0 = computeDays(base, analyzeFlows([], new Set(["a1"])), new Map(), "CAD", xic({}))[0]!.r!;
        const r1 = computeDays(withDep, analyzeFlows([act("d", "a1", "CONTRIBUTION", "2026-08-25", String(deposit))], new Set(["a1"])), new Map(), "CAD", xic({}))[0]!.r!;
        return near(r0) === near(r1);
      }),
    );
  });

  it("cumulative return equals the product of daily returns", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(fc.integer({ min: -500, max: 500 }), fc.integer({ min: -500, max: 500 })), { minLength: 1, maxLength: 40 }), (moves) => {
        const ds = moves.map(([r, b], i) => day(i % 28, new D(r).div(10_000).toString(), new D(b).div(10_000).toString()));
        const m = computeMetrics(ds);
        const prod = ds.reduce((p, d) => p.times(ONE.plus(d.r!)), ONE).minus(ONE);
        return near(m.cumulativeYou) === near(prod) && m.trend.length === ds.length + 1 && m.trend[0]!.you.isZero();
      }),
    );
  });
});
