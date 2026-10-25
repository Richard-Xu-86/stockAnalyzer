import type { ActivityRow, CashRow, PositionRow } from "@/domain/types";
import type { SnapActivity, SnapPosition } from "@/lib/snaptrade/schemas";

/** Converts SnapTrade shapes into domain rows. Numbers become decimal strings at this boundary. */
export function toPositionRow(accountId: string, p: SnapPosition): PositionRow {
  const kind = p.instrument.kind;
  const ticker = p.instrument.symbol ?? p.instrument.ticker ?? p.instrument.id ?? "unknown";
  return {
    accountId,
    symbolKey: p.instrument.id ?? ticker,
    ticker,
    kind,
    units: p.units,
    price: p.price ?? null,
    // Options are priced per share; SnapTrade gives the contract multiplier (100, or 10 for minis).
    multiplier: p.instrument.multiplier ?? (kind === "option" ? "100" : "1"),
    currency: p.currency ?? p.instrument.currency ?? "UNKNOWN",
    costBasis: p.cost_basis ?? null,
  };
}

export function toCashRows(accountId: string, balances: Array<{ currency?: { code: string } | null; cash?: number | null }>): CashRow[] {
  return balances.filter((b) => b.currency?.code && b.cash !== null && b.cash !== undefined).map((b) => ({ accountId, currency: b.currency!.code, cash: String(b.cash) }));
}

export function toActivityRow(accountId: string, a: SnapActivity): ActivityRow | null {
  const date = (a.trade_date ?? a.settlement_date)?.slice(0, 10);
  if (!date) return null; // no date: cannot place it in time; never guessed
  return {
    id: a.id,
    accountId,
    type: a.type,
    date,
    amount: a.amount === null || a.amount === undefined ? null : String(a.amount),
    currency: a.currency?.code ?? null,
  };
}
