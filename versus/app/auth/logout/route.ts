import { isSameOrigin, redirect303 } from "@/lib/http";
import { appSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Signs out of Versus only. Tracking continues; disconnecting is a separate, explicit choice. */
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new Response("Forbidden", { status: 403 });
  (await appSession()).destroy();
  return redirect303(req, "/");
}
