import { redirect } from "next/navigation";
import { getDb } from "@/lib/db/client";
import * as repo from "@/lib/db/repo";
import { appSession } from "@/lib/session";
import { loadDashboard, parseBenchmark, parseCurrency } from "@/services/load";
import { Dashboard } from "@/ui/Dashboard";
import { Shell } from "@/ui/Shell";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const session = await appSession();
  if (!session.userId) redirect("/");
  const db = await getDb();
  const user = await repo.getUser(db, session.userId);
  if (!user) redirect("/"); // deleted (retention or disconnect) since the cookie was issued
  await repo.touchVisit(db, user.id); // keeps tracking active; 90 days without a visit pauses it
  const model = await loadDashboard(db, user.id, parseBenchmark(user.benchmark), parseCurrency(user.currency));

  return (
    <Shell
      right={
        <form action="/auth/logout" method="post">
          <button className="btn btn-quiet" type="submit">Sign out</button>
        </form>
      }
      footer={
        <section aria-labelledby="disconnect-h">
          <h2 id="disconnect-h" className="small">Disconnect</h2>
          <form className="disconnect small" action="/auth/disconnect" method="post">
            <label>
              <input type="radio" name="history" value="keep" defaultChecked />
              <span>Stop tracking and keep my history. Sign in again later to continue where you left off.</span>
            </label>
            <label>
              <input type="radio" name="history" value="delete" />
              <span>Stop tracking and delete everything Versus stored about me.</span>
            </label>
            <p>
              <button className="btn btn-destructive" type="submit">Disconnect</button>
            </p>
          </form>
          <p>History is kept while you visit at least once every 12 months. Tracking pauses after 90 days without a visit; sign in to resume.</p>
        </section>
      }
    >
      <Dashboard model={model} toggle={{ action: "/api/preferences", method: "post" }} status={{ trackingState: user.trackingState, historySynced: user.historySyncedAt !== null }}
        history={{ view: q.history ?? "recent", hrefFor: (v) => (v === "recent" ? "/dashboard#history-h" : `/dashboard?history=${v}#history-h`) }}
      />
    </Shell>
  );
}
