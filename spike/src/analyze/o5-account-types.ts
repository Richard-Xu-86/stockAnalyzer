import type { Account } from "./types.js";

/**
 * O5: seed mapping from broker `raw_type` strings to our account types.
 * Matching is on normalised text. Unknown strings stay "unknown" and the user corrects
 * them; detection never guesses. Extend this table only from observed values.
 */
export type AccountType = "tfsa" | "rrsp" | "taxable" | "unknown";

const PATTERNS: ReadonlyArray<[RegExp, AccountType]> = [
  [/\btfsa\b|tax[ -]?free savings/, "tfsa"],
  // RRSP family: spousal RRSP, LIRA and LRSP are locked-in RRSP equivalents for withholding purposes.
  [/\brrsp\b|registered retirement savings|\bspousal rrsp\b|\blira\b|\blrsp\b/, "rrsp"],
  [/\b(margin|cash|individual|joint|non[- ]?registered|taxable)\b/, "taxable"],
];

export const normaliseRawType = (raw: string): string => raw.toLowerCase().replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export function mapAccountType(raw: string | null | undefined): AccountType {
  if (!raw) return "unknown";
  const text = normaliseRawType(raw);
  for (const [pattern, type] of PATTERNS) if (pattern.test(text)) return type;
  return "unknown";
}

export interface RawTypeRow {
  institution: string;
  rawType: string;
  accountCategory: string;
  mapped: AccountType;
  count: number;
}

export function analyzeRawTypes(accounts: Account[]): RawTypeRow[] {
  const rows = new Map<string, RawTypeRow>();
  for (const a of accounts) {
    const institution = a.institution_name ?? "(none)";
    const rawType = a.raw_type ?? "(null)";
    const accountCategory = a.account_category ?? "(null)";
    const key = `${institution}|${rawType}|${accountCategory}`;
    const existing = rows.get(key);
    if (existing) existing.count++;
    else rows.set(key, { institution, rawType, accountCategory, mapped: mapAccountType(a.raw_type), count: 1 });
  }
  return [...rows.values()].sort((x, y) => x.institution.localeCompare(y.institution) || x.rawType.localeCompare(y.rawType));
}
