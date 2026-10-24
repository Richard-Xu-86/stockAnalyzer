import type { Db } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { BENCHMARKS, type BenchmarkId, type Ccy } from "@/domain/types";
import { buildDashboard, type DashboardModel } from "./dashboard";

/** Reads one user's stored data and builds the page. Everything is recomputed per request: the
 *  inputs are small (one row per trading day) and recomputing means a fix to the maths applies
 *  to all history at once. */
export async function loadDashboard(db: Db, userId: string, benchmark: BenchmarkId, currency: Ccy): Promise<DashboardModel> {
  const [snapshots, activities, fx, sp500, tsx, accounts] = await Promise.all([
    repo.loadSnapshots(db, userId),
    repo.loadActivities(db, userId),
    repo.loadFx(db),
    repo.loadBenchmark(db, BENCHMARKS.sp500.ticker),
    repo.loadBenchmark(db, BENCHMARKS.tsx.ticker),
    repo.listAccounts(db, userId),
  ]);
  const synced = accounts.filter((a) => a.included && !a.userExcluded).map((a) => a.transactionsSyncedThrough);
  const transactionsSyncedNow = synced.length > 0 && synced.every((d): d is string => d !== null) ? [...synced].sort()[0]! : null;
  return buildDashboard({ snapshots, activities, fx, benchmarkPrices: { sp500, tsx }, benchmark, currency, transactionsSyncedNow });
}

export const parseBenchmark = (v: unknown, fallback: BenchmarkId = "sp500"): BenchmarkId => (v === "sp500" || v === "tsx" ? v : fallback);
export const parseCurrency = (v: unknown, fallback: Ccy = "CAD"): Ccy => (v === "CAD" || v === "USD" ? v : fallback);
