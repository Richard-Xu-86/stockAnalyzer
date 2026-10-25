import { getDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { isSameOrigin, redirect303 } from "@/lib/http";
import { appSession } from "@/lib/session";
import { parseBenchmark, parseCurrency } from "@/services/load";

export const dynamic = "force-dynamic";

/** The S&P 500 / TSX and CAD / USD buttons. Plain form POST, so they work without JavaScript. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new Response("Forbidden", { status: 403 });
  const session = await appSession();
  if (!session.userId) return redirect303(req, "/");
  const db = await getDb();
  const user = await repo.getUser(db, session.userId);
  if (!user) return redirect303(req, "/");
  const form = await req.formData();
  await repo.setPreferences(db, user.id, parseBenchmark(form.get("b"), user.benchmark as "sp500" | "tsx"), parseCurrency(form.get("c"), user.currency as "CAD" | "USD"));
  return redirect303(req, "/dashboard");
}
