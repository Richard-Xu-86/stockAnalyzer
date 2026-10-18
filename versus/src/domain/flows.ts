import { addDays } from "@/lib/calendar";
import { dec, type Dec } from "./decimal";
import type { ActivityRow } from "./types";

/**
 * Turns activities into external cash flows (money in or out of the whole portfolio) and
 * in-transit transfers between the user's own accounts.
 *
 * - Dividends and interest are returns, not flows.
 * - Internal transfers are matched OUT→IN by equal amount and currency within 7 calendar days
 *   (about 5 business days). Matched pairs are not flows; between the two dates the money is
 *   "in transit" and is added back to portfolio value, so a Monday-out, Wednesday-in transfer
 *   is neither a loss nor a gain. Unmatched internal transfers are treated as external flows.
 * - An external asset transfer with no cash amount cannot be valued: its date is flagged and
 *   the day containing it is excluded rather than guessed.
 */
const EXTERNAL = new Set(["CONTRIBUTION", "WITHDRAWAL", "REFERRAL", "REIMBURSEMENT", "EXTERNAL_ASSET_TRANSFER_IN", "EXTERNAL_ASSET_TRANSFER_OUT"]);
const INTERNAL_OUT = new Set(["INTERNAL_CASH_TRANSFER_OUT"]);
const INTERNAL_IN = new Set(["INTERNAL_CASH_TRANSFER_IN"]);
export const TRANSFER_MATCH_DAYS = 7;

export interface Flow {
  accountId: string;
  date: string;
  amount: Dec; // signed: + into the portfolio, − out
  currency: string;
  activityId: string;
  kind: "external" | "unmatched_transfer";
}

export interface Transit {
  outDate: string;
  inDate: string;
  amount: Dec; // positive
  currency: string;
}

export interface FlowAnalysis {
  flows: Flow[];
  transits: Transit[];
  unvaluedDates: Set<string>;
}

export function analyzeFlows(activities: ActivityRow[], connectedAccounts: ReadonlySet<string>): FlowAnalysis {
  const flows: Flow[] = [];
  const unvaluedDates = new Set<string>();
  const outs: ActivityRow[] = [];
  const ins: ActivityRow[] = [];

  for (const a of activities) {
    if (!connectedAccounts.has(a.accountId)) continue;
    const amount = dec(a.amount);
    if (EXTERNAL.has(a.type)) {
      if (!amount || !a.currency) {
        if (a.type.startsWith("EXTERNAL_ASSET")) unvaluedDates.add(a.date);
        continue;
      }
      flows.push({ accountId: a.accountId, date: a.date, amount, currency: a.currency, activityId: a.id, kind: "external" });
    } else if (INTERNAL_OUT.has(a.type) && amount && a.currency) outs.push(a);
    else if (INTERNAL_IN.has(a.type) && amount && a.currency) ins.push(a);
    // A generic TRANSFER (seen in real Wealthsimple data) carries its direction in the sign.
    // Treated like an internal transfer: matched if its other leg is ours, else money in or out.
    else if (a.type === "TRANSFER" && amount && !amount.isZero() && a.currency) (amount.isNegative() ? outs : ins).push(a);
  }

  // Greedy match, earliest first, deterministic by (date, id).
  const byDate = (x: ActivityRow, y: ActivityRow) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id);
  outs.sort(byDate);
  ins.sort(byDate);
  const usedIn = new Set<string>();
  const transits: Transit[] = [];
  for (const o of outs) {
    const oAmt = dec(o.amount)!.abs();
    const match = ins.find(
      (i) => !usedIn.has(i.id) && i.accountId !== o.accountId && i.currency === o.currency && dec(i.amount)!.abs().eq(oAmt) && i.date >= o.date && i.date <= addDays(o.date, TRANSFER_MATCH_DAYS),
    );
    if (match) {
      usedIn.add(match.id);
      if (match.date > o.date) transits.push({ outDate: o.date, inDate: match.date, amount: oAmt, currency: o.currency! });
    } else {
      flows.push({ accountId: o.accountId, date: o.date, amount: oAmt.neg(), currency: o.currency!, activityId: o.id, kind: "unmatched_transfer" });
    }
  }
  for (const i of ins) {
    if (!usedIn.has(i.id)) flows.push({ accountId: i.accountId, date: i.date, amount: dec(i.amount)!.abs(), currency: i.currency!, activityId: i.id, kind: "unmatched_transfer" });
  }
  flows.sort((x, y) => x.date.localeCompare(y.date) || x.activityId.localeCompare(y.activityId));
  return { flows, transits, unvaluedDates };
}
