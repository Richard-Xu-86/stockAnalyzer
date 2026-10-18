import { parseKeyring, type Keyring } from "@/lib/crypto";
import { getDb } from "@/lib/db/client";
import { env } from "@/lib/env";
import type { OAuthConfig } from "@/lib/oauth/oauth";
import type { SnapshotDeps } from "./snapshot";

/** Production wiring, built from validated environment variables. Tests build their own. */
let ring: Keyring | undefined;

export function keyring(): Keyring {
  ring ??= parseKeyring(env().TOKEN_KEYS, env().TOKEN_KEY_ID);
  return ring;
}

export function oauthConfig(): OAuthConfig {
  const e = env();
  return { issuer: e.SNAPTRADE_ISSUER, clientId: e.SNAPTRADE_OAUTH_CLIENT_ID, clientSecret: e.SNAPTRADE_OAUTH_CLIENT_SECRET, redirectUri: e.SNAPTRADE_REDIRECT_URI };
}

export async function prodDeps(): Promise<SnapshotDeps> {
  const e = env();
  return { db: await getDb(), ring: keyring(), oauth: oauthConfig(), snaptradeBase: e.SNAPTRADE_API_BASE, bocBase: e.BOC_API_BASE };
}
