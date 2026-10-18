import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { newKey, parseKeyring } from "@/lib/crypto";
import { readRefreshToken, saveGrant } from "@/lib/oauth/grants";
import { _resetDiscoveryCache } from "@/lib/oauth/oauth";
import { noPacing } from "@/lib/snaptrade/client";
import { runDaily, runRetention, snapshotUser, type SnapshotDeps } from "@/services/snapshot";
import { testDb } from "./db";
import { API, BOC, fakeFetch, fakeState, ISSUER, type FakeState } from "./fake-snaptrade";

const CLOSE = new Date("2026-08-24T22:00:00Z"); // Monday 6 PM New York: inside the close window
const NOON = new Date("2026-08-24T16:00:00Z"); // market open
const ring = parseKeyring(`k1:${newKey()}`, "k1");

let db: Db;
let s: FakeState;
let userId: string;
const deps = (now: Date): SnapshotDeps => ({
  db,
  ring,
  oauth: { issuer: ISSUER, clientId: "cid", clientSecret: "secret", redirectUri: "http://127.0.0.1:3000/auth/callback" },
  snaptradeBase: API + "/",
  bocBase: BOC,
  fetchImpl: fakeFetch(s),
  pacer: () => noPacing,
  now: () => now,
});

beforeEach(async () => {
  _resetDiscoveryCache();
  ({ db } = await testDb());
  s = fakeState();
  const u = await repo.upsertUser(db, "sub-1", "r@example.com", true);
  userId = u.id;
  await saveGrant(db, ring, userId, { access_token: s.accessToken, refresh_token: s.refreshToken, expires_in: 36000, scope: "openid email read" }, new Date("2026-08-24T20:00:00Z"));
});

describe("snapshot job", () => {
  it("stores a close snapshot of investment accounts only, plus full history the first time", async () => {
    expect(await snapshotUser(deps(CLOSE), userId)).toBe("ok");
    const [snap] = await repo.loadSnapshots(db, userId);
    expect(snap).toMatchObject({ date: "2026-08-24", status: "ok", accountIds: ["tfsa"], transactionsSyncedMin: "2026-08-24" });
    expect(snap!.positions).toHaveLength(1);
    expect(snap!.cash.map((c) => [c.accountId, c.currency, Number(c.cash)])).toEqual([["tfsa", "CAD", 500]]);
    expect(s.calls.some((c) => c.includes("chequing/positions"))).toBe(false); // DEPOSIT accounts are never read
    expect((await repo.loadActivities(db, userId)).map((a) => a.id)).toEqual(["d1"]);
    expect((await repo.getUser(db, userId))!.trackingState).toBe("day_zero");
  });

  it("only syncs history outside the close window, never storing intraday prices as a close", async () => {
    expect(await snapshotUser(deps(NOON), userId)).toBe("history_only");
    expect(await repo.loadSnapshots(db, userId)).toHaveLength(0);
    expect((await repo.getUser(db, userId))!.historySyncedAt).not.toBeNull();
  });

  it("is idempotent: running twice for the same close leaves one snapshot", async () => {
    await snapshotUser(deps(CLOSE), userId);
    s.cash.tfsa = [{ code: "CAD", cash: 650 }];
    await snapshotUser(deps(new Date("2026-08-24T23:00:00Z")), userId);
    const snaps = await repo.loadSnapshots(db, userId);
    expect(snaps).toHaveLength(1);
    expect(Number(snaps[0]!.cash[0]!.cash)).toBe(650); // the later fetch replaces, never duplicates
  });

  it("marks the snapshot stale when the broker's data predates the close", async () => {
    s.asOf = "2026-08-24T15:00:00Z";
    await snapshotUser(deps(CLOSE), userId);
    expect((await repo.loadSnapshots(db, userId))[0]!.status).toBe("stale");
  });

  it("refreshes once on 401, persists the rotated refresh token, and keeps going", async () => {
    s.accessToken = "rotated-server-side"; // our stored access token is now rejected
    expect(await snapshotUser(deps(CLOSE), userId)).toBe("ok");
    expect(s.refreshCount).toBe(1);
    expect(await readRefreshToken(db, ring, userId)).toBe(s.refreshToken);
  });

  it("asks for sign-in when the refresh token is dead, without retrying the refresh", async () => {
    s.accessToken = "x";
    s.refreshToken = "someone-else-has-it";
    expect(await snapshotUser(deps(CLOSE), userId)).toBe("needs_signin");
    expect((await repo.getUser(db, userId))!.trackingState).toBe("needs_signin");
    expect(s.calls.filter((c) => c.includes("/oauth/token/"))).toHaveLength(1);
  });

  it("treats a token endpoint outage as a failure to retry, not a sign-out", async () => {
    s.accessToken = "x";
    s.failures.push({ match: "/oauth/token/", statuses: [503] });
    expect(await snapshotUser(deps(CLOSE), userId)).toBe("failed");
    expect((await repo.getUser(db, userId))!.trackingState).not.toBe("needs_signin");
  });

  it("retries 429 and 5xx from the API", async () => {
    s.failures.push({ match: "/accounts", statuses: [429, 502] });
    expect(await snapshotUser(deps(CLOSE), userId)).toBe("ok");
  });

  it("skips a user whose sync lease is held by another instance", async () => {
    expect(await repo.claimSyncLease(db, userId, 60_000, CLOSE)).toBe(true);
    expect(await snapshotUser(deps(CLOSE), userId)).toBe("skipped");
  });

  it("re-reads activities from 3 days before the last good snapshot", async () => {
    await snapshotUser(deps(CLOSE), userId);
    s.calls = [];
    await snapshotUser(deps(new Date("2026-08-25T22:00:00Z")), userId);
    expect(s.calls.find((c) => c.includes("activities"))).toBeDefined();
    // the fake filters by startDate; d1 (Aug 3) must survive the windowed replace
    expect((await repo.loadActivities(db, userId)).map((a) => a.id)).toEqual(["d1"]);
  });
});

describe("daily run", () => {
  it("captures FX, both benchmarks once, and every active user", async () => {
    const r = await runDaily(deps(CLOSE), "snapshot");
    expect(r).toMatchObject({ date: "2026-08-24", ok: 1, failed: 0, benchmarks: true });
    expect(Number((await repo.loadBenchmark(db, "SPY")).get("2026-08-24"))).toBe(640.12);
    expect(Number((await repo.loadBenchmark(db, "XIC.TO")).get("2026-08-24"))).toBe(41.5);
    expect(Number((await repo.loadFx(db)).get("2026-08-24"))).toBe(1.379);
    expect(s.calls.filter((c) => c.includes("quotes"))).toHaveLength(1);
  });

  it("does nothing outside the close window", async () => {
    expect((await runDaily(deps(NOON), "snapshot")).skipped).toBeDefined();
    expect(s.calls).toHaveLength(0);
  });

  it("the retry run only fills what the first run missed", async () => {
    await runDaily(deps(CLOSE), "snapshot");
    s.calls = [];
    const r = await runDaily(deps(new Date("2026-08-24T23:00:00Z")), "retry");
    expect(r.ok).toBe(0);
    expect(s.calls.some((c) => c.includes("positions"))).toBe(false);
    expect(s.calls.some((c) => c.includes("quotes"))).toBe(false);
  });

  it("pauses users who have not visited in 90 days, and retention deletes after 12 months", async () => {
    await db.execute(sql`update users set last_visit_at = ${new Date("2026-05-01T00:00:00Z")}`);
    expect((await runDaily(deps(CLOSE), "snapshot")).ok).toBe(0);
    expect(await runRetention(deps(CLOSE))).toBe(0);
    await db.execute(sql`update users set last_visit_at = ${new Date("2025-08-01T00:00:00Z")}`);
    expect(await runRetention(deps(CLOSE))).toBe(1);
    expect(await repo.getUser(db, userId)).toBeNull();
  });
});
