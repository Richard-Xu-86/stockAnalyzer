import { dec, Decimal } from "./decimal.js";
import type { Activity } from "./types.js";

/**
 * O2: where does the commission live?
 * For a trade, SnapTrade's sign convention gives amount ≈ -(units × price) - fee
 * when the fee is inside the cash amount (buy: +units, -amount; sell: -units, +amount).
 * residual = amount + units × price is therefore -fee if included, 0 if not.
 */
const TOLERANCE = new Decimal("0.01"); // one cent; brokers round cash to cents
const TRADE_TYPES = new Set(["BUY", "SELL"]);

export type FeePlacement = "fee_in_amount" | "fee_not_in_amount" | "no_fee" | "unexplained" | "incomplete";

export interface TradeFeeRow {
  id: string;
  type: string;
  fee: string | null;
  residual: string | null;
  placement: FeePlacement;
  linkedFeeRows: number;
}

/** Shares per contract for option activities (100, or 10 for minis); 1 for everything else. */
export function contractMultiplier(a: Activity): number {
  const opt = a.option_symbol;
  if (opt === null || opt === undefined || typeof opt !== "object") return 1;
  return (opt as { is_mini_option?: unknown }).is_mini_option === true ? 10 : 100;
}

export function classifyTradeFee(a: Activity): FeePlacement {
  const amount = dec(a.amount);
  const units = dec(a.units)?.times(contractMultiplier(a)) ?? null;
  const price = dec(a.price);
  const fee = dec(a.fee);
  if (!amount || !units || !price) return "incomplete";
  const residual = amount.plus(units.times(price));
  const feeVal = fee ?? new Decimal(0);
  if (feeVal.isZero()) return residual.abs().lte(TOLERANCE) ? "no_fee" : "unexplained";
  if (residual.plus(feeVal).abs().lte(TOLERANCE)) return "fee_in_amount";
  if (residual.abs().lte(TOLERANCE)) return "fee_not_in_amount";
  return "unexplained";
}

export interface CommissionFindings {
  trades: TradeFeeRow[];
  counts: Record<FeePlacement, number>;
  tradesWithLinkedFeeRow: number;
  tradesWithBothFeeAndLinkedRow: number;
}

export function analyzeCommissions(activities: Activity[]): CommissionFindings {
  const feeRowsByRef = new Map<string, number>();
  for (const a of activities) {
    if (a.type === "FEE" && a.external_reference_id) {
      feeRowsByRef.set(a.external_reference_id, (feeRowsByRef.get(a.external_reference_id) ?? 0) + 1);
    }
  }
  const counts: Record<FeePlacement, number> = { fee_in_amount: 0, fee_not_in_amount: 0, no_fee: 0, unexplained: 0, incomplete: 0 };
  const trades: TradeFeeRow[] = [];
  let linked = 0;
  let both = 0;
  for (const a of activities) {
    if (!a.type || !TRADE_TYPES.has(a.type)) continue;
    const placement = classifyTradeFee(a);
    counts[placement]++;
    const linkedFeeRows = a.external_reference_id ? (feeRowsByRef.get(a.external_reference_id) ?? 0) : 0;
    if (linkedFeeRows > 0) linked++;
    const fee = dec(a.fee);
    if (linkedFeeRows > 0 && fee && !fee.isZero()) both++;
    const amount = dec(a.amount);
    const units = dec(a.units)?.times(contractMultiplier(a)) ?? null;
    const price = dec(a.price);
    trades.push({
      id: a.id ?? "(no id)",
      type: a.type,
      fee: fee?.toString() ?? null,
      residual: amount && units && price ? amount.plus(units.times(price)).toString() : null,
      placement,
      linkedFeeRows,
    });
  }
  return { trades, counts, tradesWithLinkedFeeRow: linked, tradesWithBothFeeAndLinkedRow: both };
}
