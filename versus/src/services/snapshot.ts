import { addDays, closeDateFor, closeInstant, isCloseWindow, isKnownYear } from "@/lib/calendar";
import { fetchUsdCad } from "@/lib/boc";
import type { Keyring } from "@/lib/crypto";
import type { Db } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { log } from "@/lib/log";
import { discover, refreshTokens, type OAuthConfig } from "@/lib/oauth/oauth";
import { grantTokenProvider } from "@/lib/oauth/grants";
import { AuthError, SnapTradeClient, type Pacer } from "@/lib/snaptrade/client";
import { BENCHMARKS } from "@/domain/types";
import { toActivityRow, toCashRows, toPositionRow } from "./normalize";

/**
 * The daily snapshot job: the product's heartbeat. Records each user's broker-priced portfolio
 * and the two benchmarks after the close. History cannot be backfilled, so this runs first in the
 * build and stores raw responses alongside normalized rows.
 */
export interface SnapshotDeps {
  db: Db;
  ring: Keyring;
  oauth: OAuthConfig;
  snaptradeBase: string;
  bocBase: string;
  fetchImpl?: typeof fetch;
  pacer?: (db: Db) => Pacer;
  now?: () => Date;
}

const USER_LEASE_MS = 5 * 60_000;
const ACTIVITY_OVERLAP_DAYS = 3;
export const ACTIVE_DAYS = 90; // tracking pauses after 90 days without a visit
export const RETENTION_DAYS = 365; // data deleted after 12 months without a visit
const RUN_BUDGET_MS = 240_000; // stay inside the function time limit; the retry run finishes the rest

export type UserOutcome = "ok" | "history_only" | "skipped" | "needs_signin" | "failed";

function clientFor(deps: SnapshotDeps, userId: string): SnapTradeClient {
  const f = deps.fetchImpl ?? fetch;
  const tokens = grantTokenProvider(deps.db, deps.ring, userId, async (rt) => refreshTokens(deps.oauth, await discover(deps.oauth, f), rt, f), deps.now);
  return new SnapTradeClient(deps.snaptradeBase, tokens, deps.pacer ? deps.pacer(deps.db) : repo.dbPacer(deps.db), f);
}

/**
 * One user: sync accounts and activities, and (inside the close window) store the close snapshot.
 * Outside the close window (e.g. a sign-in at noon) only history is synced: intraday prices are
 * never stored as a close.
 */
export async function snapshotUser(deps: SnapshotDeps, userId: string): Promise<UserOutcome> {
  const db = deps.db;
  const now = (deps.now ?? (() => new Date()))();
  if (!(await repo.claimSyncLease(db, userId, USER_LEASE_MS, now))) return "skipped";
  try {
    const user = await repo.getUser(db, userId);
    if (!user) return "skipped";
    const api = clientFor(deps, userId);

    const snapAccounts = await api.listAccounts();
    const stored = await repo.upsertAccounts(
      db,
      userId,
      snapAccounts.map((a) => ({
        id: a.id,
        connectionId: a.brokerage_authorization ?? null,
        institution: a.institution_name,
        name: a.name ?? null,
        rawType: a.raw_type ?? null,
        accountCategory: a.account_category ?? null,
        transactionsSyncedThrough: a.sync_status?.transactions?.last_successful_sync?.slice(0, 10) ?? null,
      })),
    );
    const included = stored.filter((a) => a.included && !a.userExcluded);

    // Activities: full history the first time (day-one history), then from 3 days before the last
    // good snapshot, so a gap of any length can never hide a deposit.
    const lastOk = await repo.lastOkSnapshotDate(db, userId);
    const fromDate = user.historySyncedAt ? addDays(lastOk ?? user.historySyncedAt.toISOString().slice(0, 10), -ACTIVITY_OVERLAP_DAYS) : null;
    for (const a of included) {
      const acts = await api.activities(a.id, fromDate ?? undefined);
      const rows = acts.map((x) => toActivityRow(a.id, x)).filter((x): x is NonNullable<typeof x> => x !== null);
      await repo.replaceActivities(db, userId, a.id, fromDate, rows, new Map(acts.map((x) => [x.id, x])));
    }
    await repo.markHistorySynced(db, userId, now);

    if (!isCloseWindow(now)) return "history_only";

    const date = closeDateFor(now);
    const positions = [];
    const cash = [];
    const raw: Record<string, unknown> = {};
    let asOf: Date | null = null;
    for (const a of included) {
      const p = await api.positions(a.id);
      const b = await api.balances(a.id);
      raw[a.id] = { positions: p, balances: b };
      positions.push(...p.results.map((x) => toPositionRow(a.id, x)));
      cash.push(...toCashRows(a.id, b));
      const t = p.data_freshness?.as_of ? new Date(p.data_freshness.as_of) : null;
      if (t && (asOf === null || t < asOf)) asOf = t;
    }
    const syncDates = included.map((a) => a.transactionsSyncedThrough);
    const transactionsSyncedMin = syncDates.length && syncDates.every((d) => d !== null) ? (syncDates as string[]).sort()[0]! : null;
    // Fresh means fetched after that trading day's close (the spike saw as_of = request time).
    const status = asOf !== null && asOf.getTime() >= closeInstant(date).getTime() ? "ok" : "stale";

    await repo.writeSnapshot(db, { userId, date, capturedAt: now, asOf, status, transactionsSyncedMin, accountIds: included.map((a) => a.id), positions, cash, raw });
    if (status === "ok") await repo.setTrackingState(db, userId, lastOk ? "tracking" : "day_zero");
    return "ok";
  } catch (err) {
    if (err instanceof AuthError) {
      await repo.setTrackingState(db, userId, "needs_signin");
      log.warn("user needs sign-in", { userId, reason: err.message });
      return "needs_signin";
    }
    log.error("snapshot failed", { userId, error: err as Error });
    return "failed";
  } finally {
    await repo.releaseSyncLease(db, userId);
  }
}

/** One shared /quotes call per trading day for both benchmarks; idempotent, only fills what is missing. */
export async function captureBenchmarks(deps: SnapshotDeps, date: string, candidates: string[]): Promise<boolean> {
  const db = deps.db;
  const missing = async () => {
    const all = Object.values(BENCHMARKS);
    const have = await Promise.all(all.map(async (b) => (await repo.loadBenchmark(db, b.ticker)).has(date)));
    return all.filter((_, i) => !have[i]);
  };
  let need = await missing();
  for (const userId of candidates) {
    if (need.length === 0) break;
    const first = (await repo.listAccounts(db, userId)).find((a) => a.included && !a.userExcluded);
    if (!first) continue;
    try {
      const quotes = await clientFor(deps, userId).quotes(first.id, need.map((b) => b.ticker));
      const capturedAt = (deps.now ?? (() => new Date()))();
      for (const b of need) {
        const price = quotes.find((x) => x.symbol.symbol === b.ticker)?.last_trade_price;
        if (price !== null && price !== undefined && price > 0) {
          await repo.upsertBenchmarkPrice(db, b.ticker, date, String(price), b.currency, "snaptrade_quotes", capturedAt);
        }
      }
    } catch (err) {
      log.warn("benchmark capture failed; trying another grant", { error: err as Error });
    }
    need = await missing();
  }
  return need.length === 0;
}

export async function ensureFx(deps: SnapshotDeps, from: string, to: string): Promise<void> {
  try {
    const rates = await fetchUsdCad(deps.bocBase, from, to, deps.fetchImpl ?? fetch);
    await repo.upsertFx(deps.db, rates);
  } catch (err) {
    log.warn("bank of canada fetch failed", { error: err as Error });
  }
}

export interface RunSummary {
  skipped?: string;
  date?: string;
  ok: number;
  failed: number;
  remaining: number;
  benchmarks: boolean;
}

/**
 * The cron entry point. `retry` mode (second cron) only fills what the first run missed:
 * benchmark prices and users without a snapshot for the day.
 */
export async function runDaily(deps: SnapshotDeps, mode: "snapshot" | "retry"): Promise<RunSummary> {
  const now = (deps.now ?? (() => new Date()))();
  if (!isCloseWindow(now)) return { skipped: "outside the close window", ok: 0, failed: 0, remaining: 0, benchmarks: false };
  const date = closeDateFor(now);
  if (!isKnownYear(date)) log.error("market calendar has no holidays for this year; extend src/lib/calendar.ts", { date });
  const runId = await repo.startRun(deps.db, mode, date);
  const started = Date.now();

  await ensureFx(deps, addDays(date, -10), date);
  const users = await repo.usersForRun(deps.db, ACTIVE_DAYS, now);

  let ok = 0;
  let failed = 0;
  let remaining = 0;
  for (const u of users) {
    if (Date.now() - started > RUN_BUDGET_MS) {
      remaining++;
      continue;
    }
    if (mode === "retry" && (await repo.hasSnapshotFor(deps.db, u.id, date))) continue;
    const outcome = await snapshotUser(deps, u.id);
    if (outcome === "ok" || outcome === "history_only") ok++;
    else if (outcome !== "skipped") failed++;
  }
  // After the users, so a brand-new deployment already has stored accounts to quote through.
  const benchmarks = await captureBenchmarks(deps, date, users.map((u) => u.id));
  await repo.finishRun(deps.db, runId, ok, failed, { remaining, benchmarks });
  log.info("daily run finished", { mode, date, ok, failed, remaining, benchmarks });
  return { date, ok, failed, remaining, benchmarks };
}

export async function runRetention(deps: SnapshotDeps): Promise<number> {
  const removed = await repo.deleteInactiveUsers(deps.db, RETENTION_DAYS, (deps.now ?? (() => new Date()))());
  log.info("retention run", { removed });
  return removed;
}
