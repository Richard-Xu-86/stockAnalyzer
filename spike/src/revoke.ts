import { rmSync } from "node:fs";
import { loadConfig } from "./config.js";
import { discover, refresh, revoke } from "./oauth.js";
import { loadTokens } from "./tokenStore.js";

/** Wrap-up check: revoke the grant, then prove the refresh token no longer works. */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const d = await discover(cfg);
  const { refreshToken } = loadTokens();
  const status = await revoke(cfg, d, refreshToken);
  console.log(`Revocation endpoint answered HTTP ${status}.`);
  try {
    await refresh(cfg, d, refreshToken);
    console.error("Unexpected: the revoked refresh token still worked.");
    process.exitCode = 1;
  } catch (err) {
    console.log(`As expected, refresh after revoke failed (${(err as Error).message}).`);
  }
  rmSync(".tokens.json", { force: true });
  console.log("Local tokens deleted.");
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
