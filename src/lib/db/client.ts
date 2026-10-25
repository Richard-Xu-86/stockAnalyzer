import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { schema } from "./schema";

/**
 * One database type for both drivers: Neon's pooled serverless driver in production and PGlite in
 * tests. Code takes a `Db` and never knows which one it has.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let prod: Db | undefined;

/** Production database. Uses Neon's pooled connection (transaction-mode PgBouncer), so code must
 *  never rely on session state (no session advisory locks); leases live in rows instead. */
export async function getDb(): Promise<Db> {
  if (prod) return prod;
  const [{ Pool }, { drizzle }, { env }] = await Promise.all([import("@neondatabase/serverless"), import("drizzle-orm/neon-serverless"), import("../env")]);
  const pool = new Pool({ connectionString: env().DATABASE_URL });
  prod = drizzle({ client: pool, schema }) as unknown as Db;
  return prod;
}
