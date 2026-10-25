import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "@/lib/db/client";
import { schema } from "@/lib/db/schema";

/** A fresh in-process Postgres with the real migrations applied. Same SQL as production. */
export async function testDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  const dir = join(import.meta.dirname, "..", "migrations");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) await pg.exec(readFileSync(join(dir, f), "utf8"));
  return { db: drizzle({ client: pg, schema }) as unknown as Db, pg };
}
