import { env } from "@/lib/env";
import { isCronAuthorized } from "@/lib/http";
import { log } from "@/lib/log";
import { prodDeps } from "./deps";
import { runDaily, runRetention } from "./snapshot";

/** Shared wrapper for the three cron routes: auth, run, a small JSON summary with no personal data. */
export async function cronHandler(req: Request, job: "snapshot" | "retry" | "retention"): Promise<Response> {
  if (!isCronAuthorized(req, env().CRON_SECRET)) return new Response("Unauthorized", { status: 401 });
  try {
    const deps = await prodDeps();
    const body = job === "retention" ? { removed: await runRetention(deps) } : await runDaily(deps, job);
    return Response.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    log.error("cron failed", { job, error: err as Error });
    return Response.json({ error: "run failed" }, { status: 500 });
  }
}
