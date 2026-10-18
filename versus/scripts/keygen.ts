import { randomBytes } from "node:crypto";
import { newKey } from "../src/lib/crypto";

/** Prints fresh secrets for .env. Run once per environment; never commit the output. */
const keyId = `k${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
console.log(`SESSION_SECRET=${randomBytes(32).toString("base64url")}`);
console.log(`TOKEN_KEYS=${keyId}:${newKey()}`);
console.log(`TOKEN_KEY_ID=${keyId}`);
console.log(`CRON_SECRET=${randomBytes(24).toString("base64url")}`);
