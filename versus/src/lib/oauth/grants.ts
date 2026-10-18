import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { oauthGrants } from "../db/schema";
import { open, seal, type Keyring } from "../crypto";
import { sleep } from "../retry";
import { AuthError, type TokenProvider } from "../snaptrade/client";
import type { TokenSet } from "./oauth";

/**
 * Encrypted token storage with a refresh lease.
 * Refresh tokens rotate: the old one dies on use. Two serverless instances refreshing at once
 * would lose the grant, so one claims a short lease in a single atomic UPDATE; the others wait
 * and re-read. No transaction is held open during the HTTP call (pooled connections).
 */
const REFRESH_LEASE_MS = 30_000;
const REFRESH_EARLY_MS = 5 * 60_000; // refresh when less than 5 minutes remain
const WAIT_STEP_MS = 500;

export async function saveGrant(db: Db, ring: Keyring, userId: string, t: TokenSet, now = new Date()): Promise<void> {
  const access = seal(ring, t.access_token);
  const refresh = seal(ring, t.refresh_token);
  if (access.keyId !== refresh.keyId) throw new Error("key changed mid-seal");
  const values = {
    accessTokenEnc: access.sealed,
    refreshTokenEnc: refresh.sealed,
    keyId: access.keyId,
    accessExpiresAt: new Date(now.getTime() + t.expires_in * 1000),
    scope: t.scope,
    refreshLeaseUntil: null,
    updatedAt: now,
  };
  await db
    .insert(oauthGrants)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: oauthGrants.userId, set: { ...values, version: sql`${oauthGrants.version} + 1` } });
}

export async function deleteGrant(db: Db, userId: string): Promise<void> {
  await db.delete(oauthGrants).where(eq(oauthGrants.userId, userId));
}

export async function readRefreshToken(db: Db, ring: Keyring, userId: string): Promise<string | null> {
  const [g] = await db.select().from(oauthGrants).where(eq(oauthGrants.userId, userId));
  return g ? open(ring, g.keyId, g.refreshTokenEnc) : null;
}

/** TokenProvider for one user, backed by the grant row. */
export function grantTokenProvider(db: Db, ring: Keyring, userId: string, doRefresh: (refreshToken: string) => Promise<TokenSet>, clock: () => Date = () => new Date()): TokenProvider {
  const load = async () => {
    const [g] = await db.select().from(oauthGrants).where(eq(oauthGrants.userId, userId));
    if (!g) throw new AuthError("No grant for user");
    return g;
  };

  const refresh = async (): Promise<string> => {
    const before = await load();
    const now = clock();
    const claimed = await db
      .update(oauthGrants)
      .set({ refreshLeaseUntil: new Date(now.getTime() + REFRESH_LEASE_MS) })
      .where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.version, before.version), or(isNull(oauthGrants.refreshLeaseUntil), lt(oauthGrants.refreshLeaseUntil, now))))
      .returning({ userId: oauthGrants.userId });
    if (claimed.length === 0) {
      // Someone else is refreshing (or just did): wait for the version to move, then use theirs.
      for (let waited = 0; waited < REFRESH_LEASE_MS; waited += WAIT_STEP_MS) {
        await sleep(WAIT_STEP_MS);
        const g = await load();
        if (g.version !== before.version) return open(ring, g.keyId, g.accessTokenEnc);
      }
      throw new AuthError("Timed out waiting for a concurrent token refresh");
    }
    try {
      const next = await doRefresh(open(ring, before.keyId, before.refreshTokenEnc));
      await saveGrant(db, ring, userId, next, clock());
      return next.access_token;
    } catch (err) {
      await db.update(oauthGrants).set({ refreshLeaseUntil: null }).where(eq(oauthGrants.userId, userId));
      throw err; // AuthError (grant dead) or a transient failure the next run retries
    }
  };

  return {
    async accessToken() {
      const g = await load();
      if (g.accessExpiresAt.getTime() - clock().getTime() < REFRESH_EARLY_MS) return refresh();
      return open(ring, g.keyId, g.accessTokenEnc);
    },
    refresh,
  };
}
