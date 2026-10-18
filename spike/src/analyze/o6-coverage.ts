import { dec } from "./decimal.js";
import type { Account, Activity } from "./types.js";

/** O6: what the Sandbox actually contains, and which golden-portfolio edge cases it can stand in for. */
export interface CoverageSummary {
  activityCount: number;
  byType: Record<string, number>;
  currencies: string[];
  firstDate: string | null;
  lastDate: string | null;
  accounts: Array<{ id: string; firstTransactionDate: string | null; initialSyncCompleted: boolean | null; lastSuccessfulSync: string | null }>;
}

const dateOf = (a: Activity) => (a.trade_date ?? a.settlement_date)?.slice(0, 10) ?? null;

export function summarise(accounts: Account[], activities: Activity[]): CoverageSummary {
  const byType: Record<string, number> = {};
  const currencies = new Set<string>();
  const dates: string[] = [];
  for (const a of activities) {
    const t = a.type ?? "(null)";
    byType[t] = (byType[t] ?? 0) + 1;
    if (a.currency?.code) currencies.add(a.currency.code);
    const d = dateOf(a);
    if (d) dates.push(d);
  }
  dates.sort();
  return {
    activityCount: activities.length,
    byType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b))),
    currencies: [...currencies].sort(),
    firstDate: dates[0] ?? null,
    lastDate: dates.at(-1) ?? null,
    accounts: accounts.map((a) => ({
      id: a.id,
      firstTransactionDate: a.sync_status?.transactions?.first_transaction_date ?? null,
      initialSyncCompleted: a.sync_status?.transactions?.initial_sync_completed ?? null,
      lastSuccessfulSync: a.sync_status?.transactions?.last_successful_sync ?? null,
    })),
  };
}

const hasType = (acts: Activity[], t: string) => acts.some((a) => a.type === t);
const positiveFee = (a: Activity) => dec(a.fee)?.gt(0) ?? false;
const isTrade = (a: Activity) => a.type === "BUY" || a.type === "SELL";
const weekday = (a: Activity) => {
  const d = dateOf(a);
  return d === null ? null : new Date(`${d}T00:00:00Z`).getUTCDay();
};

/** Each design-doc edge case and a predicate that says whether Sandbox data exercises it. */
export const EDGE_CASES: ReadonlyArray<{ id: string; label: string; covered: (acts: Activity[], accts: Account[]) => boolean }> = [
  { id: "C1", label: "Trade with commission in `fee`", covered: (x) => x.some((a) => isTrade(a) && positiveFee(a)) },
  { id: "C2", label: "FEE row linked to a trade by external_reference_id", covered: (x) => { const refs = new Set(x.filter(isTrade).map((a) => a.external_reference_id).filter(Boolean)); return x.some((a) => a.type === "FEE" && a.external_reference_id !== null && a.external_reference_id !== undefined && refs.has(a.external_reference_id)); } },
  { id: "C3", label: "Trade with `fx_rate` set", covered: (x) => x.some((a) => isTrade(a) && a.fx_rate !== null && a.fx_rate !== undefined) },
  { id: "C3-weekend", label: "FX trade dated on a weekend", covered: (x) => x.some((a) => a.fx_rate != null && [0, 6].includes(weekday(a) ?? -1)) },
  { id: "C4", label: "TAX linked to a DIVIDEND", covered: (x) => { const divRefs = new Set(x.filter((a) => a.type === "DIVIDEND").map((a) => a.external_reference_id).filter(Boolean)); return x.some((a) => a.type === "TAX" && (divRefs.has(a.external_reference_id ?? "") || x.some((d) => d.type === "DIVIDEND" && dateOf(d) === dateOf(a) && d.symbol?.id === a.symbol?.id))); } },
  { id: "C5", label: "TAX with no linked dividend", covered: (x) => hasType(x, "TAX") },
  { id: "C6", label: "FEE with no symbol", covered: (x) => x.some((a) => a.type === "FEE" && !a.symbol) },
  { id: "C7", label: "FEE with a symbol", covered: (x) => x.some((a) => a.type === "FEE" && Boolean(a.symbol)) },
  { id: "C8", label: "Negative INTEREST (margin)", covered: (x) => x.some((a) => a.type === "INTEREST" && (dec(a.amount)?.lt(0) ?? false)) },
  { id: "C9-option", label: "Option activity", covered: (x) => x.some((a) => a.option_symbol != null) },
  { id: "C9-unknown", label: "Type outside the documented list", covered: (x) => x.some((a) => a.type !== null && a.type !== undefined && !KNOWN_TYPES.has(a.type)) },
  { id: "multi-ccy", label: "More than one currency", covered: (x) => new Set(x.map((a) => a.currency?.code).filter(Boolean)).size > 1 },
  { id: "registered", label: "Account whose raw_type looks like TFSA or RRSP", covered: (_x, accts) => accts.some((a) => /tfsa|rrsp|tax[ -]?free|retirement/i.test(a.raw_type ?? "")) },
  { id: "dedupe", label: "Same institution_account_id under two connections", covered: (_x, accts) => { const seen = new Map<string, string>(); return accts.some((a) => { const k = a.institution_account_id; if (!k) return false; const prev = seen.get(k); seen.set(k, a.connectionId ?? ""); return prev !== undefined && prev !== (a.connectionId ?? ""); }); } },
];

// From SnapTrade's Sandbox page "All transaction types" table.
const KNOWN_TYPES = new Set(["BUY", "SELL", "CONTRIBUTION", "WITHDRAWAL", "INTEREST", "FEE", "TAX", "REBATE", "DIVIDEND", "REI", "STOCK_DIVIDEND", "RETURN_OF_CAPITAL", "DISTRIBUTION", "OPTIONEXPIRATION", "OPTIONASSIGNMENT", "OPTIONEXERCISE", "SPLIT", "REVERSE_SPLIT", "SPINOFF", "STOCK_MERGER", "ADJUSTMENT", "TRANSFER", "EXTERNAL_ASSET_TRANSFER_IN", "EXTERNAL_ASSET_TRANSFER_OUT", "INTERNAL_CASH_TRANSFER_IN", "INTERNAL_CASH_TRANSFER_OUT", "INTERNAL_ASSET_TRANSFER_IN", "INTERNAL_ASSET_TRANSFER_OUT", "SUBSTITUTE_DIVIDEND"]);

export function edgeCaseCoverage(activities: Activity[], accounts: Account[]) {
  return EDGE_CASES.map((e) => ({ id: e.id, label: e.label, coveredBySandbox: e.covered(activities, accounts) }));
}
