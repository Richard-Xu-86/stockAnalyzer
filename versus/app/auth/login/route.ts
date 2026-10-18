import { authorizeUrl, discover, randomToken } from "@/lib/oauth/oauth";
import { loginSession } from "@/lib/session";
import { oauthConfig } from "@/services/deps";

export const dynamic = "force-dynamic";

/** Starts sign-in: fresh state, nonce and PKCE verifier, held in a 10-minute encrypted cookie. */
export async function GET(req: Request) {
  const cfg = oauthConfig();
  // The login cookie must live on the same host SnapTrade sends the user back to. If the user opened
  // the app on another name for this server (localhost vs 127.0.0.1), restart sign-in on the right one.
  const home = new URL(cfg.redirectUri);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host && host !== home.host) {
    return new Response(null, { status: 302, headers: { Location: `${home.origin}/auth/login`, "Cache-Control": "no-store" } });
  }
  const d = await discover(cfg);
  const login = await loginSession();
  login.state = randomToken();
  login.nonce = randomToken();
  login.verifier = randomToken(48);
  await login.save();
  return new Response(null, { status: 302, headers: { Location: authorizeUrl(cfg, d, { state: login.state, nonce: login.nonce, verifier: login.verifier }), "Cache-Control": "no-store" } });
}
