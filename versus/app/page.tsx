import { redirect } from "next/navigation";
import { appSession } from "@/lib/session";
import { Shell } from "@/ui/Shell";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Nothing was connected.",
  expired: "That sign-in link expired. Start again below.",
  failed: "Sign-in didn't complete. Try again; if it keeps failing, SnapTrade may be having trouble.",
};

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  // Sign-in needs the server configured (.env.local); the landing page and demo work without it.
  let configured = true;
  let signedIn = false;
  try {
    signedIn = Boolean((await appSession()).userId);
  } catch {
    configured = false;
  }
  if (signedIn) redirect("/dashboard");
  const msg = q.signin ? MESSAGES[q.signin] : q.disconnected === "delete" ? "Disconnected. Everything we stored about you has been deleted." : q.disconnected === "keep" ? "Disconnected. Tracking has stopped; sign in again any time to pick up where you left off." : null;
  return (
    <Shell>
      {!configured && (
        <div className="banner" role="status">
          <p>
            <strong>Sign-in isn&apos;t set up on this server yet.</strong> Fill in <code>.env.local</code> (see the README). The sample portfolio works without it.
          </p>
        </div>
      )}
      {msg && (
        <div className="banner info" role="status">
          <p>{msg}</p>
        </div>
      )}
      <section className="hero">
        <h1>Did you beat the market today?</h1>
        <p>
          Versus records your portfolio after every weekday close and compares it with the S&amp;P 500 or the TSX, in Canadian or US dollars. Deposits and withdrawals are taken out, so a paycheque landing never looks like a good day.
        </p>
        <div className="actions">
          <a className="btn btn-primary" href="/auth/login">Connect with SnapTrade</a>
          <a className="btn btn-secondary" href="/demo">See a sample portfolio</a>
        </div>
        <p className="quiet small">Read-only access. Versus can&apos;t place trades or move money.</p>
      </section>
      <div className="facts">
        <div>
          <h2>Every weekday, after the close</h2>
          <p className="quiet small">Your return next to the market&apos;s, and which holdings moved you.</p>
        </div>
        <div>
          <h2>A trend that builds over time</h2>
          <p className="quiet small">After a few weeks: how much of the market&apos;s good and bad days you catch.</p>
        </div>
        <div>
          <h2>Starts from the day you connect</h2>
          <p className="quiet small">Brokers don&apos;t keep past portfolio values, so tracking begins tonight. Your deposit and trading history shows from day one.</p>
        </div>
      </div>
    </Shell>
  );
}
