import { basename, join } from "node:path";
import { z } from "zod";
import { listDirs, listJson, readJson, readJsonIfExists, RAW_DIR } from "../io.js";
import { AccountSchema, ActivitySchema, CallRowSchema, type Activity, type RateSeries, type ScenarioData } from "./types.js";
import { parseValet } from "./o3-boc.js";

/** Activities files hold an array of pages: [{ data: [...], pagination }, ...]. */
function activitiesFromPages(pages: unknown): unknown[] {
  if (!Array.isArray(pages)) return [];
  return pages.flatMap((p) => (p && typeof p === "object" && Array.isArray((p as { data?: unknown }).data) ? (p as { data: unknown[] }).data : []));
}

export function loadScenario(scenario: string, root = RAW_DIR): ScenarioData {
  const dir = join(root, scenario);
  const rawAccounts = z.array(z.unknown()).parse(readJsonIfExists(join(dir, "accounts.json")) ?? []);
  const accounts = rawAccounts.map((a) => AccountSchema.parse(a));

  const activitiesByAccount = new Map<string, Activity[]>();
  const rawActivities: unknown[] = [];
  for (const file of listJson(join(dir, "activities"))) {
    const raw = activitiesFromPages(readJson(file));
    rawActivities.push(...raw);
    activitiesByAccount.set(basename(file, ".json"), raw.map((r) => ActivitySchema.parse(r)));
  }

  const calls = z.array(CallRowSchema).parse(readJsonIfExists(join(dir, "calls.json")) ?? []);
  const probe = readJsonIfExists(join(dir, "ratelimit-probe.json"));
  const refreshProbe = readJsonIfExists(join(dir, "refresh-probe.json"));
  return {
    scenario,
    accounts,
    activitiesByAccount,
    rawActivities,
    rawAccounts,
    calls,
    rateLimitProbe: probe === undefined ? undefined : z.array(CallRowSchema).parse(probe),
    refreshProbe: refreshProbe === undefined ? undefined : z.object({ rotated: z.boolean(), idTokenPresent: z.boolean() }).parse(refreshProbe),
  };
}

export function loadAllScenarios(root = RAW_DIR): ScenarioData[] {
  return listDirs(root).filter((d) => d !== "boc").map((d) => loadScenario(d, root));
}

export interface BocLoad {
  /** Keyed by foreign currency code, e.g. "USD" for FXUSDCAD. */
  series: Map<string, RateSeries>;
  statuses: Array<{ series: string; status: number; error?: string }>;
}

const BocFileSchema = z.object({ status: z.number(), body: z.unknown() });

export function loadBoc(root = RAW_DIR): BocLoad {
  const series = new Map<string, RateSeries>();
  const statuses: BocLoad["statuses"] = [];
  for (const file of listJson(join(root, "boc"))) {
    const name = basename(file, ".json");
    const { status, body } = BocFileSchema.parse(readJson(file));
    try {
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const match = /^FX([A-Z]{3})CAD$/.exec(name);
      if (!match?.[1]) throw new Error("series name is not FX{CCY}CAD");
      series.set(match[1], parseValet(name, body));
      statuses.push({ series: name, status });
    } catch (err) {
      statuses.push({ series: name, status, error: (err as Error).message });
    }
  }
  return { series, statuses };
}
