import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { z } from "zod";
import type { TokenResponse } from "./oauth.js";

/**
 * Spike-only token store: a local file with owner-only permissions, gitignored.
 * The product stores encrypted tokens in Postgres; this file never ships.
 */
const PATH = ".tokens.json";

const StoredSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.iso.datetime(),
  scope: z.string(),
});
export type StoredTokens = z.infer<typeof StoredSchema>;

export function toStored(t: TokenResponse, now = new Date()): StoredTokens {
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    accessExpiresAt: new Date(now.getTime() + t.expires_in * 1000).toISOString(),
    scope: t.scope,
  };
}

/** Write-then-rename so a crash never leaves a half-written file (and a lost rotated token). */
export function saveTokens(t: StoredTokens): void {
  const tmp = `${PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(t, null, 2), { mode: 0o600 });
  renameSync(tmp, PATH);
}

export function loadTokens(): StoredTokens {
  if (!existsSync(PATH)) throw new Error("No tokens found. Run `npm run login` first.");
  return StoredSchema.parse(JSON.parse(readFileSync(PATH, "utf8")));
}
