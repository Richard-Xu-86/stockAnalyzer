import type { CallRow } from "./types.js";

/** O1: which fields the design depends on are actually present, null, or typed unexpectedly. */
export const ACTIVITY_FIELDS = ["id", "type", "trade_date", "settlement_date", "amount", "units", "price", "fee", "fx_rate", "currency.code", "symbol.symbol", "symbol.currency.code", "external_reference_id", "option_symbol", "description"] as const;
export const ACCOUNT_FIELDS = ["id", "institution_name", "raw_type", "account_category", "institution_account_id", "sync_status.transactions.first_transaction_date", "sync_status.transactions.last_successful_sync", "sync_status.transactions.initial_sync_completed", "sync_status.holdings.last_successful_sync"] as const;

export interface FieldStat {
  field: string;
  total: number;
  missing: number; // key absent
  nulls: number;
  types: string[]; // JS types seen for non-null values
}

function lookup(obj: unknown, path: string): { found: boolean; value: unknown } {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(part in (cur as object))) return { found: false, value: undefined };
    cur = (cur as Record<string, unknown>)[part];
  }
  return { found: true, value: cur };
}

export function fieldPresence(records: unknown[], fields: readonly string[]): FieldStat[] {
  return fields.map((field) => {
    let missing = 0;
    let nulls = 0;
    const types = new Set<string>();
    for (const r of records) {
      const { found, value } = lookup(r, field);
      if (!found) missing++;
      else if (value === null) nulls++;
      else types.add(Array.isArray(value) ? "array" : typeof value);
    }
    return { field, total: records.length, missing, nulls, types: [...types].sort() };
  });
}

export interface EndpointStat {
  path: string;
  statuses: number[];
  maxAttempts: number;
  rateLimitHeaderNames: string[];
}

export function endpointSummary(calls: CallRow[]): EndpointStat[] {
  const byPath = new Map<string, CallRow[]>();
  for (const c of calls) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c]);
  return [...byPath.entries()].map(([path, rows]) => ({
    path,
    statuses: [...new Set(rows.map((r) => r.status))].sort(),
    maxAttempts: Math.max(...rows.map((r) => r.attempts)),
    rateLimitHeaderNames: [...new Set(rows.flatMap((r) => Object.keys(r.rateLimitHeaders)))].sort(),
  }));
}

export interface RateLimitObservation {
  requests: number;
  first429At: number | null; // 1-based index of the first 429
  retryAfterOn429: string | null;
  accountRemainingSeen: string[];
}

export function rateLimitObservation(probe: CallRow[]): RateLimitObservation {
  const idx = probe.findIndex((c) => c.status === 429);
  const hit = idx >= 0 ? probe[idx] : undefined;
  return {
    requests: probe.length,
    first429At: idx >= 0 ? idx + 1 : null,
    retryAfterOn429: hit?.rateLimitHeaders["retry-after"] ?? null,
    accountRemainingSeen: probe.map((c) => c.rateLimitHeaders["x-ratelimit-account-remaining"] ?? "-"),
  };
}
