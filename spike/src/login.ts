import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { loadConfig } from "./config.js";
import { buildAuthorizeUrl, randomToken } from "./pkce.js";
import { discover, exchangeCode } from "./oauth.js";
import { saveTokens, toStored } from "./tokenStore.js";

/**
 * One-shot local login: prints the authorize URL, waits for the callback on the
 * registered loopback redirect, exchanges the code, stores tokens, exits.
 * Scope matches the product: openid email read. No trade, no webhook.
 */
const SCOPE = "openid email read";
const LOGIN_TIMEOUT_MS = 10 * 60_000;

const safeEqual = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function main(): Promise<void> {
  const cfg = loadConfig();
  const d = await discover(cfg);
  console.log(`Discovery OK. Scopes advertised: ${d.scopes_supported?.join(" ") ?? "(not listed)"}`);

  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken(64);
  const redirect = new URL(cfg.SNAPTRADE_REDIRECT_URI);

  const authorizeUrl = buildAuthorizeUrl({
    authorizationEndpoint: d.authorization_endpoint,
    clientId: cfg.SNAPTRADE_OAUTH_CLIENT_ID,
    redirectUri: cfg.SNAPTRADE_REDIRECT_URI,
    scope: SCOPE,
    state,
    nonce,
    verifier,
  });

  let used = false; // the verifier is single-use
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", redirect.origin);
    if (url.pathname !== redirect.pathname) {
      res.writeHead(404).end();
      return;
    }
    const finish = (status: number, message: string) => {
      res.writeHead(status, { "Content-Type": "text/plain", "Cache-Control": "no-store" }).end(message);
      server.close();
    };
    if (used) return finish(400, "Callback already handled.");
    used = true;

    const error = url.searchParams.get("error");
    const returnedState = url.searchParams.get("state") ?? "";
    if (!safeEqual(returnedState, state)) return finish(400, "State mismatch: login rejected.");
    if (error) return finish(400, `SnapTrade returned "${error}". Nothing was stored.`);

    const code = url.searchParams.get("code");
    if (!code) return finish(400, "No code in callback.");
    try {
      const tokens = await exchangeCode(cfg, d, code, verifier);
      saveTokens(toStored(tokens));
      console.log(`Signed in. Granted scope: ${tokens.scope}. id_token present: ${Boolean(tokens.id_token)}.`);
      console.log("Tokens saved to .tokens.json (owner-only). Next: npm run collect");
      finish(200, "Signed in. You can close this tab and return to the terminal.");
    } catch (err) {
      console.error((err as Error).message);
      finish(500, "Token exchange failed; see terminal.");
    }
  });

  server.listen(Number(redirect.port || 80), redirect.hostname, () => {
    console.log("\nOpen this URL in your browser and approve access:\n");
    console.log(authorizeUrl);
  });
  setTimeout(() => {
    console.error("Timed out waiting for the callback.");
    server.close();
    process.exitCode = 1;
  }, LOGIN_TIMEOUT_MS).unref();
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
