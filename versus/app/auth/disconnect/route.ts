import { getDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { isSameOrigin, redirect303 } from "@/lib/http";
import { log } from "@/lib/log";
import { deleteGrant, readRefreshToken } from "@/lib/oauth/grants";
import { discover, revokeRefreshToken } from "@/lib/oauth/oauth";
import { appSession } from "@/lib/session";
import { keyring, oauthConfig } from "@/services/deps";

export const dynamic = "force-dynamic";

/**
 * Disconnect. The user chooses:
 *  keep   — revoke access and stop tracking, keep the history (signing in again resumes it)
 *  delete — revoke access and delete every row we hold for them
 */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const session = await appSession();
  if (!session.userId) return redirect303(req, "/");
  const choice = (await req.formData()).get("history");
  if (choice !== "keep" && choice !== "delete") return new Response("Choose keep or delete", { status: 400 });

  const db = await getDb();
  const userId = session.userId;
  try {
    const rt = await readRefreshToken(db, keyring(), userId);
    if (rt) await revokeRefreshToken(oauthConfig(), await discover(oauthConfig()), rt);
  } catch (err) {
    // Revocation is best effort: we still destroy our copy, which is what makes it unusable to us.
    log.warn("revocation failed", { error: err as Error });
  }
  if (choice === "delete") await repo.deleteUser(db, userId);
  else {
    await deleteGrant(db, userId);
    await repo.setTrackingState(db, userId, "stopped");
  }
  session.destroy();
  return redirect303(req, `/?disconnected=${choice}`);
}
