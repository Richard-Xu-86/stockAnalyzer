import { analyzeFlows } from "@/domain/flows";
import { dayOneHistory, type DayOneHistory } from "@/domain/history";
import { computeMetrics, type Metrics } from "@/domain/metrics";
import { computeDays, type DayResult, type HoldingEffect } from "@/domain/returns";
import { ZERO, sum, type Dec } from "@/domain/decimal";
import { BENCHMARKS, type ActivityRow, type BenchmarkId, type Ccy, type Snapshot } from "@/domain/types";

/**
 * Builds everything the dashboard shows from stored data. Pure: the same inputs always give the
 * same page, which is what makes demo mode and the tests trustworthy.
 */
export interface DashboardInput {
  snapshots: Snapshot[];
  activities: ActivityRow[];
  fx: ReadonlyMap<string, string>;
  benchmarkPrices: Record<BenchmarkId, ReadonlyMap<string, string>>;
  benchmark: BenchmarkId;
  currency: Ccy;
}

export interface DriverLine {
  label: string;
  effect: Dec;
  kind: "holding" | "currency" | "remainder";
}

export interface DashboardModel {
  benchmark: BenchmarkId;
  benchmarkLabel: string;
  currency: Ccy;
  trackingSince: string | null;
  latest: DayResult | null;
  drivers: DriverLine[];
  metrics: Metrics;
  recentDays: DayResult[];
  dayOne: DayOneHistory;
  okSnapshots: number;
}

const TOP_DRIVERS = 3;

export function buildDashboard(input: DashboardInput): DashboardModel {
  const connected = new Set<string>([...input.activities.map((a) => a.accountId), ...input.snapshots.flatMap((s) => s.accountIds)]);
  const flows = analyzeFlows(input.activities, connected);
  const meta = BENCHMARKS[input.benchmark];
  const days = computeDays(input.snapshots, flows, input.fx, input.currency, {
    id: input.benchmark,
    ticker: meta.ticker,
    currency: meta.currency,
    prices: input.benchmarkPrices[input.benchmark],
  });
  const ok = input.snapshots.filter((s) => s.status === "ok").sort((a, b) => a.date.localeCompare(b.date));
  const latest = days.at(-1) ?? null;
  return {
    benchmark: input.benchmark,
    benchmarkLabel: meta.label,
    currency: input.currency,
    trackingSince: ok[0]?.date ?? null,
    latest,
    drivers: latest?.drivers ? driverLines(latest.drivers.holdings, latest.drivers.cashCurrencyEffect, latest.drivers.remainder) : [],
    metrics: computeMetrics(days),
    recentDays: days.slice(-10).reverse(),
    dayOne: dayOneHistory(input.activities, flows),
    okSnapshots: ok.length,
  };
}

/** Top holdings by size of price effect, one combined currency line, and the remainder. */
export function driverLines(holdings: HoldingEffect[], cashCurrency: Dec, remainder: Dec): DriverLine[] {
  const byTicker = new Map<string, Dec>();
  for (const h of holdings) byTicker.set(h.ticker, (byTicker.get(h.ticker) ?? ZERO).plus(h.priceEffect));
  const top = [...byTicker.entries()].sort((a, b) => b[1].abs().cmp(a[1].abs()));
  const shown = top.slice(0, TOP_DRIVERS);
  const others = sum(top.slice(TOP_DRIVERS).map(([, v]) => v));
  const currency = sum(holdings.map((h) => h.currencyEffect)).plus(cashCurrency);
  const lines: DriverLine[] = shown.map(([label, effect]) => ({ label, effect, kind: "holding" }));
  if (!others.isZero()) lines.push({ label: "Other holdings", effect: others, kind: "holding" });
  if (!currency.isZero()) lines.push({ label: "Currency moves", effect: currency, kind: "currency" });
  lines.push({ label: "Trades and cash", effect: remainder, kind: "remainder" });
  return lines;
}
