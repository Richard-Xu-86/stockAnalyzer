import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { log } from "@/lib/log";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public health check: configuration valid, database reachable, tables present, and when the last
 * daily run finished. Says which step failed (never secrets or values) and logs the error for Vercel.
 */
export async function GET() {
  let step = "config";
  try {
    const db = await getDb();
    step = "database";
    await db.execute(sql`select 1`);
    step = "tables";
    const run = await repo.lastRun(db);
    return Response.json({ ok: true, lastRun: run ? { kind: run.kind, date: run.tradingDate, finishedAt: run.finishedAt, ok: run.usersOk, failed: run.usersFailed } : null }, { headers: NO_STORE });
  } catch (err) {
    log.error("health check failed", { step, error: err as Error });
    const hint = {
      config: "An environment variable is missing or invalid; the function log names which one.",
      database: "Can't connect to the database: check DATABASE_URL (the pooled Neon URL) is set for this environment.",
      tables: "Connected, but the tables are missing: run `npm run db:migrate` against this DATABASE_URL.",
    }[step];
    return Response.json({ ok: false, failedAt: step, hint }, { status: 503, headers: NO_STORE });
  }
}
