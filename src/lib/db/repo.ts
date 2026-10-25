import { and, asc, eq, gte, inArray, isNull, lt, or, sql, notInArray } from "drizzle-orm";
import type { Db } from "./client";
import { accounts, activities, benchmarkPrices, cashSnapshots, fxRates, portfolioSnapshots, positionSnapshots, snapshotRuns, users } from "./schema";
import type { ActivityRow, CashRow, PositionRow, Snapshot } from "@/domain/types";
import type { Pacer } from "../snaptrade/client";
import { sleep } from "../retry";

/**
 * Every per-user read and write goes through here and requires a userId, so a query can never
 * forget to scope by user. Shared reference tables (benchmarks, FX) are the only exception.
 */
export type UserRow = typeof users.$inferSelect;
export type TrackingState = "connected" | "day_zero" | "tracking" | "needs_signin" | "broken" | "stopped";

export async function upsertUser(db: Db, sub: string, email: string | null, emailVerified: boolean): Promise<UserRow> {
  const [u] = await db
    .insert(users)
    .values({ snaptradeSub: sub, email, emailVerified })
    .onConflictDoUpdate({ target: users.snaptradeSub, set: { email, emailVerified, lastVisitAt: new Date() } })
    .returning();
  return u!;
}

export async function getUser(db: Db, userId: string): Promise<UserRow | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  return u ?? null;
}

export async function touchVisit(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ lastVisitAt: new Date() }).where(eq(users.id, userId));
}

export async function setPreferences(db: Db, userId: string, benchmark: "sp500" | "tsx", currency: "CAD" | "USD"): Promise<void> {
  await db.update(users).set({ benchmark, currency }).where(eq(users.id, userId));
}

export async function markHistorySynced(db: Db, userId: string, at: Date): Promise<void> {
  await db.update(users).set({ historySyncedAt: at }).where(eq(users.id, userId));
}

export async function setTrackingState(db: Db, userId: string, state: TrackingState): Promise<void> {
  await db.update(users).set({ trackingState: state }).where(eq(users.id, userId));
}

export async function deleteUser(db: Db, userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId)); // cascades to every per-user table
}

/** One snapshot run per user at a time, across serverless instances. */
export async function claimSyncLease(db: Db, userId: string, ms: number, now = new Date()): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ syncLeaseUntil: new Date(now.getTime() + ms) })
    .where(and(eq(users.id, userId), or(isNull(users.syncLeaseUntil), lt(users.syncLeaseUntil, now))))
    .returning({ id: users.id });
  return rows.length === 1;
}

export async function releaseSyncLease(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ syncLeaseUntil: null }).where(eq(users.id, userId));
}

export interface AccountInput {
  id: string;
  connectionId: string | null;
  institution: string;
  name: string | null;
  rawType: string | null;
  accountCategory: string | null;
  transactionsSyncedThrough: string | null;
}

/** Upserts the accounts SnapTrade returned; `included` follows category unless the user excluded it. */
export async function upsertAccounts(db: Db, userId: string, rows: AccountInput[]): Promise<Array<typeof accounts.$inferSelect>> {
  for (const r of rows) {
    const included = r.accountCategory === "INVESTMENT";
    await db
      .insert(accounts)
      .values({ ...r, userId, included })
      .onConflictDoUpdate({
        target: accounts.id,
        set: { connectionId: r.connectionId, institution: r.institution, name: r.name, rawType: r.rawType, accountCategory: r.accountCategory, transactionsSyncedThrough: r.transactionsSyncedThrough, included, updatedAt: new Date() },
      });
  }
  // Accounts SnapTrade no longer returns (connection removed, account closed) stop counting.
  // Otherwise every run would keep querying them, fail, and freeze the "provisional" label.
  const returned = rows.map((r) => r.id);
  await db
    .update(accounts)
    .set({ included: false, updatedAt: new Date() })
    .where(returned.length ? and(eq(accounts.userId, userId), notInArray(accounts.id, returned)) : eq(accounts.userId, userId));
  return db.select().from(accounts).where(eq(accounts.userId, userId));
}

export async function listAccounts(db: Db, userId: string) {
  return db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(asc(accounts.institution), asc(accounts.name));
}

/** Window replacement, not upsert: SnapTrade activity IDs can change when it re-processes data. */
export async function replaceActivities(db: Db, userId: string, accountId: string, fromDate: string | null, rows: ActivityRow[], raw: Map<string, unknown>): Promise<void> {
  await db.transaction(async (tx) => {
    const scope = and(eq(activities.userId, userId), eq(activities.accountId, accountId));
    await tx.delete(activities).where(fromDate ? and(scope, gte(activities.tradeDate, fromDate)) : scope);
    const inWindow = rows.filter((r) => fromDate === null || r.date >= fromDate);
    if (inWindow.length) {
      await tx.insert(activities).values(
        inWindow.map((r) => ({ userId, accountId, activityId: r.id, type: r.type, tradeDate: r.date, amount: r.amount, currency: r.currency, units: null, price: null, symbol: null, raw: raw.get(r.id) ?? {} })),
      ).onConflictDoNothing();
    }
  });
}

export async function loadActivities(db: Db, userId: string): Promise<ActivityRow[]> {
  const rows = await db.select().from(activities).where(eq(activities.userId, userId)).orderBy(asc(activities.tradeDate));
  return rows.map((r) => ({ id: r.activityId, accountId: r.accountId, type: r.type, date: r.tradeDate, amount: r.amount, currency: r.currency }));
}

export interface SnapshotWrite {
  userId: string;
  date: string;
  capturedAt: Date;
  asOf: Date | null;
  status: "ok" | "stale" | "failed";
  transactionsSyncedMin: string | null;
  accountIds: string[];
  positions: PositionRow[];
  cash: CashRow[];
  raw: unknown;
}

/** Idempotent: one snapshot per user per trading date; a re-run replaces it whole. */
export async function writeSnapshot(db: Db, s: SnapshotWrite): Promise<void> {
  await db.transaction(async (tx) => {
    const key = and(eq(positionSnapshots.userId, s.userId), eq(positionSnapshots.tradingDate, s.date));
    await tx.delete(positionSnapshots).where(key);
    await tx.delete(cashSnapshots).where(and(eq(cashSnapshots.userId, s.userId), eq(cashSnapshots.tradingDate, s.date)));
    if (s.positions.length) await tx.insert(positionSnapshots).values(s.positions.map((p) => ({ ...p, userId: s.userId, tradingDate: s.date })));
    if (s.cash.length) await tx.insert(cashSnapshots).values(s.cash.map((c) => ({ ...c, userId: s.userId, tradingDate: s.date })));
    const row = { capturedAt: s.capturedAt, asOf: s.asOf, status: s.status, transactionsSyncedMin: s.transactionsSyncedMin, accountIds: s.accountIds, raw: s.raw as object };
    await tx
      .insert(portfolioSnapshots)
      .values({ userId: s.userId, tradingDate: s.date, ...row })
      .onConflictDoUpdate({ target: [portfolioSnapshots.userId, portfolioSnapshots.tradingDate], set: row });
  });
}

export async function loadSnapshots(db: Db, userId: string): Promise<Snapshot[]> {
  const heads = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId)).orderBy(asc(portfolioSnapshots.tradingDate));
  const pos = await db.select().from(positionSnapshots).where(eq(positionSnapshots.userId, userId));
  const cash = await db.select().from(cashSnapshots).where(eq(cashSnapshots.userId, userId));
  return heads.map((h) => ({
    date: h.tradingDate,
    status: h.status as Snapshot["status"],
    accountIds: h.accountIds,
    transactionsSyncedMin: h.transactionsSyncedMin,
    positions: pos.filter((p) => p.tradingDate === h.tradingDate).map((p) => ({ accountId: p.accountId, symbolKey: p.symbolKey, ticker: p.ticker, kind: p.kind, units: p.units, price: p.price, multiplier: p.multiplier, currency: p.currency, costBasis: p.costBasis })),
    cash: cash.filter((c) => c.tradingDate === h.tradingDate).map((c) => ({ accountId: c.accountId, currency: c.currency, cash: c.cash })),
  }));
}

export async function lastOkSnapshotDate(db: Db, userId: string): Promise<string | null> {
  const [r] = await db
    .select({ d: sql<string>`max(${portfolioSnapshots.tradingDate})::text` })
    .from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.userId, userId), eq(portfolioSnapshots.status, "ok")));
  return r?.d ?? null;
}

/** True when the user already has a good ("ok") close for `date`. */
export async function hasSnapshotFor(db: Db, userId: string, date: string): Promise<boolean> {
  // Only a good close counts: a "stale" snapshot is exactly what the retry run exists to replace.
  const rows = await db
    .select({ d: portfolioSnapshots.tradingDate })
    .from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.userId, userId), eq(portfolioSnapshots.tradingDate, date), eq(portfolioSnapshots.status, "ok")));
  return rows.length > 0;
}

/** Users the daily job should snapshot: tracking-capable and seen in the last `activeDays`. */
export async function usersForRun(db: Db, activeDays: number, now = new Date()): Promise<UserRow[]> {
  const since = new Date(now.getTime() - activeDays * 86_400_000);
  return db.select().from(users).where(and(inArray(users.trackingState, ["connected", "day_zero", "tracking"]), gte(users.lastVisitAt, since)));
}

export async function deleteInactiveUsers(db: Db, inactiveDays: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - inactiveDays * 86_400_000);
  const gone = await db.delete(users).where(lt(users.lastVisitAt, cutoff)).returning({ id: users.id });
  return gone.length;
}

// ---- Shared reference data ----

export async function upsertBenchmarkPrice(db: Db, ticker: string, date: string, price: string, currency: string, source: string, capturedAt: Date): Promise<void> {
  await db
    .insert(benchmarkPrices)
    .values({ ticker, tradingDate: date, price, currency, source, capturedAt })
    .onConflictDoUpdate({ target: [benchmarkPrices.ticker, benchmarkPrices.tradingDate], set: { price, currency, source, capturedAt } });
}

export async function loadBenchmark(db: Db, ticker: string): Promise<Map<string, string>> {
  const rows = await db.select().from(benchmarkPrices).where(eq(benchmarkPrices.ticker, ticker));
  return new Map(rows.map((r) => [r.tradingDate, r.price]));
}

export async function upsertFx(db: Db, rates: Map<string, string>): Promise<void> {
  for (const [d, rate] of rates) {
    await db.insert(fxRates).values({ base: "USD", quote: "CAD", rateDate: d, rate }).onConflictDoNothing();
  }
}

export async function loadFx(db: Db): Promise<Map<string, string>> {
  const rows = await db.select().from(fxRates).where(and(eq(fxRates.base, "USD"), eq(fxRates.quote, "CAD")));
  return new Map(rows.map((r) => [r.rateDate, r.rate]));
}

export async function startRun(db: Db, kind: string, date: string | null): Promise<number> {
  const [r] = await db.insert(snapshotRuns).values({ kind, tradingDate: date }).returning({ id: snapshotRuns.id });
  return r!.id;
}

export async function finishRun(db: Db, id: number, ok: number, failed: number, detail: object): Promise<void> {
  await db.update(snapshotRuns).set({ finishedAt: new Date(), usersOk: ok, usersFailed: failed, detail }).where(eq(snapshotRuns.id, id));
}

export async function lastRun(db: Db) {
  const [r] = await db.select().from(snapshotRuns).where(eq(snapshotRuns.kind, "snapshot")).orderBy(sql`${snapshotRuns.id} desc`).limit(1);
  return r ?? null;
}

/**
 * Per-account pacing on Postgres: atomically reserves the next slot (8 calls/minute/account,
 * under SnapTrade's 10) and sleeps until it. Works across serverless instances.
 */
const SLOT_MS = 7_500;
export function dbPacer(db: Db): Pacer {
  return {
    async waitTurn(accountId) {
      const [r] = await db
        .update(accounts)
        .set({ nextRequestAt: sql`greatest(coalesce(${accounts.nextRequestAt}, now()), now()) + (${SLOT_MS} * interval '1 millisecond')` })
        .where(eq(accounts.id, accountId))
        .returning({ next: accounts.nextRequestAt });
      if (!r?.next) return;
      const slot = r.next.getTime() - SLOT_MS;
      const wait = slot - Date.now();
      if (wait > 0) await sleep(wait);
    },
  };
}
