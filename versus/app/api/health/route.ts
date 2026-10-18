import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";

export const dynamic = "force-dynamic";

/** Public health check: database reachable and when the last daily run finished. No personal data. */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    const run = await repo.lastRun(db);
    return Response.json({ ok: true, lastRun: run ? { kind: run.kind, date: run.tradingDate, finishedAt: run.finishedAt, ok: run.usersOk, failed: run.usersFailed } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
