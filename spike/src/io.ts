import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const RAW_DIR = "raw";

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readJsonIfExists(path: string): unknown {
  return existsSync(path) ? readJson(path) : undefined;
}

export function listDirs(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

export function listJson(path: string): string[] {
  if (!existsSync(path)) return [];
  return readdirSync(path).filter((f) => f.endsWith(".json")).sort().map((f) => join(path, f));
}
