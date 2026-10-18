import { after } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { redirect303 } from "@/lib/http";
import { log } from "@/lib/log";
import { saveGrant } from "@/lib/oauth/grants";
import { discover, exchangeCode, verifyIdToken } from "@/lib/oauth/oauth";
import { appSession, loginSession } from "@/lib/session";
import { keyring, oauthConfig, prodDeps } from "@/services/deps";
import { snapshotUser } from "@/services/snapshot";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // the first history sync runs after the response

const fail = (req: Request, reason: string) => redirect303(req, `/?signin=${reason}`);
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(req: Request) {
  const url = new URL(req.url);
  const login = await loginSession();
  const { state, nonce, verifier } = login;
  login.destroy(); // single use, whatever happens next

  if (url.searchParams.get("error")) return fail(req, url.searchParams.get("error") === "access_denied" ? "cancelled" : "failed");
  const code = url.searchParams.get("code");
  const gotState = url.searchParams.get("state");
  if (!code || !gotState || !state || !nonce || !verifier || !same(gotState, state)) return fail(req, "expired");

  try {
    const cfg = oauthConfig();
    const d = await discover(cfg);
    const tokens = await exchangeCode(cfg, d, code, verifier);
    if (!tokens.id_token) throw new Error("No ID token in response");
    if (!tokens.scope.split(" ").includes("read")) throw new Error("Read scope was not granted");
    const who = await verifyIdToken(tokens.id_token, d, cfg.clientId, nonce);

    const db = await getDb();
    const user = await repo.upsertUser(db, who.sub, who.email, who.emailVerified);
    await saveGrant(db, keyring(), user.id, tokens);
    if (user.trackingState === "needs_signin" || user.trackingState === "stopped") {
      await repo.setTrackingState(db, user.id, (await repo.lastOkSnapshotDate(db, user.id)) ? "tracking" : "connected");
    }

    const session = await appSession();
    session.userId = user.id;
    await session.save();

    // Day-one history (and, after the close, the first snapshot) without making the user wait.
    after(async () => {
      const outcome = await snapshotUser(await prodDeps(), user.id);
      log.info("first sync", { userId: user.id, outcome });
    });
    return redirect303(req, "/dashboard");
  } catch (err) {
    log.error("sign-in failed", { error: err as Error });
    return fail(req, "failed");
  }
}
