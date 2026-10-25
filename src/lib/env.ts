import { z } from "zod";

/** Server-only configuration, validated once. Nothing here may be exposed to the browser. */
const EnvSchema = z.object({
  SNAPTRADE_OAUTH_CLIENT_ID: z.string().min(1),
  SNAPTRADE_OAUTH_CLIENT_SECRET: z.string().min(1),
  SNAPTRADE_REDIRECT_URI: z.url(),
  SNAPTRADE_ISSUER: z.url().default("https://api.snaptrade.com"),
  SNAPTRADE_API_BASE: z.url().default("https://api.snaptrade.com"),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(32),
  TOKEN_KEYS: z.string().min(1),
  TOKEN_KEY_ID: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  BOC_API_BASE: z.url().default("https://www.bankofcanada.ca/valet"),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Names only: values may be secrets.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing or invalid environment variables: ${names}`);
  }
  cached = parsed.data;
  return cached;
}
