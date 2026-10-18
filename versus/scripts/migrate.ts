import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "@neondatabase/serverless";

// Same files Next.js reads, same priority: .env.local wins over .env (loadEnvFile never overrides).
for (const f of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(f);
  } catch {
    // file absent: fine
  }
}

/** Applies every migrations/*.sql in order. Each file is idempotent (create ... if not exists). */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pool.query(readFileSync(join(dir, file), "utf8"));
    console.log(`applied ${file}`);
  }
  await pool.end();
}

main().catch((err: unknown) => {
  console.error((err as Error).message);
  process.exitCode = 1;
});
