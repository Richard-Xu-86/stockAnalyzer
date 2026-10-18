import type { Db } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { BENCHMARKS, type BenchmarkId, type Ccy } from "@/domain/types";
import { buildDashboard, type DashboardModel } from "./dashboard";

/** Reads one user's stored data and builds the page. Everything is recomputed per request: the
 *  inputs are small (one row per trading day) and recomputing means a fix to the maths applies
 *  to all history at once. */
export async function loadDashboard(db: Db, userId: string, benchmark: BenchmarkId, currency: Ccy): Promise<DashboardModel> {
  const [snapshots, activities, fx, sp500, tsx] = await Promise.all([
    repo.loadSnapshots(db, userId),
    repo.loadActivities(db, userId),
    repo.loadFx(db),
    repo.loadBenchmark(db, BENCHMARKS.sp500.ticker),
    repo.loadBenchmark(db, BENCHMARKS.tsx.ticker),
  ]);
  return buildDashboard({ snapshots, activities, fx, benchmarkPrices: { sp500, tsx }, benchmark, currency });
}

export const parseBenchmark = (v: unknown, fallback: BenchmarkId = "sp500"): BenchmarkId => (v === "sp500" || v === "tsx" ? v : fallback);
export const parseCurrency = (v: unknown, fallback: Ccy = "CAD"): Ccy => (v === "CAD" || v === "USD" ? v : fallback);
