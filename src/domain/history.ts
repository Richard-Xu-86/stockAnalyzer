import { ZERO, type Dec } from "./decimal";
import type { FlowAnalysis } from "./flows";
import type { ActivityRow } from "./types";

/**
 * Day-one history: built from past transactions, so it is exact and available the moment a user
 * connects, before any daily snapshot exists. Amounts stay in their own currency (never summed
 * across currencies).
 */
export interface MonthRow {
  month: string; // YYYY-MM
  deposits: Record<string, Dec>; // by currency, net of withdrawals
  buys: number;
  sells: number;
}

export interface DayOneHistory {
  firstDate: string | null;
  months: MonthRow[];
  netDeposits: Record<string, Dec>;
}

export function dayOneHistory(activities: ActivityRow[], flows: FlowAnalysis): DayOneHistory {
  const months = new Map<string, MonthRow>();
  const row = (m: string) => {
    let r = months.get(m);
    if (!r) months.set(m, (r = { month: m, deposits: {}, buys: 0, sells: 0 }));
    return r;
  };
  const net: Record<string, Dec> = {};
  for (const f of flows.flows) {
    // Unmatched transfers count too: Wealthsimple funds investment accounts from chequing, which
    // Versus doesn't read, so that money arrives as a transfer from outside the tracked accounts.
    const r = row(f.date.slice(0, 7));
    r.deposits[f.currency] = (r.deposits[f.currency] ?? ZERO).plus(f.amount);
    net[f.currency] = (net[f.currency] ?? ZERO).plus(f.amount);
  }
  for (const a of activities) {
    if (a.type === "BUY") row(a.date.slice(0, 7)).buys++;
    else if (a.type === "SELL") row(a.date.slice(0, 7)).sells++;
  }
  const sorted = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  const firstDate = activities.reduce<string | null>((m, a) => (m === null || a.date < m ? a.date : m), null);
  return { firstDate, months: sorted, netDeposits: net };
}
