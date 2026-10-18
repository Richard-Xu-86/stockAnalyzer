import { readFileSync, existsSync } from "node:fs";
import { z } from "zod";

/**
 * Parses one .env line. Trims whitespace and Windows line endings and strips one pair of
 * matching quotes, so `SECRET="abc" ` yields `abc`. A stray quote or space in a client
 * secret makes the token endpoint answer 401, which is hard to diagnose.
 */
export function parseEnvLine(line: string): [string, string] | null {
  const match = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line.replace(/\r$/, ""));
  if (!match?.[1]) return null;
  let value = (match[2] ?? "").trim();
  const quoted = /^(["'])(.*)\1$/.exec(value);
  if (quoted) value = quoted[2] ?? "";
  return [match[1], value];
}

/** Minimal .env loader so the spike has no dotenv dependency. Existing env vars win. */
function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (/^\s*#/.test(line)) continue;
    const parsed = parseEnvLine(line);
    if (parsed && process.env[parsed[0]] === undefined) process.env[parsed[0]] = parsed[1];
  }
}

const EnvSchema = z.object({
  SNAPTRADE_OAUTH_CLIENT_ID: z.string().min(1),
  SNAPTRADE_OAUTH_CLIENT_SECRET: z.string().min(1),
  SNAPTRADE_REDIRECT_URI: z.url(),
  SNAPTRADE_ISSUER: z.url().default("https://api.snaptrade.com"),
  SNAPTRADE_API_BASE: z.url().default("https://api.snaptrade.com"),
  SPIKE_SCENARIO: z.string().regex(/^[a-z0-9-]+$/).default("self-directed"),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(): Config {
  loadDotEnv();
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid or missing settings in .env: ${missing}. See .env.example.`);
  }
  return parsed.data;
}
