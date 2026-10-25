import type { ActivityRow, BenchmarkSeries, CashRow, PositionRow, Snapshot } from "@/domain/types";

export const pos = (accountId: string, ticker: string, units: string, price: string | null, currency = "CAD", extra: Partial<PositionRow> = {}): PositionRow => ({
  accountId,
  symbolKey: ticker,
  ticker,
  kind: "stock",
  units,
  price,
  multiplier: "1",
  currency,
  costBasis: null,
  ...extra,
});

export const cash = (accountId: string, amount: string, currency = "CAD"): CashRow => ({ accountId, currency, cash: amount });

export const snap = (date: string, accountIds: string[], positions: PositionRow[], cashRows: CashRow[], extra: Partial<Snapshot> = {}): Snapshot => ({
  date,
  status: "ok",
  accountIds,
  transactionsSyncedMin: date,
  positions,
  cash: cashRows,
  ...extra,
});

export const act = (id: string, accountId: string, type: string, date: string, amount: string | null, currency: string | null = "CAD"): ActivityRow => ({ id, accountId, type, date, amount, currency });

export const xic = (prices: Record<string, string>): BenchmarkSeries => ({ id: "tsx", ticker: "XIC.TO", currency: "CAD", prices: new Map(Object.entries(prices)) });
export const spy = (prices: Record<string, string>): BenchmarkSeries => ({ id: "sp500", ticker: "SPY", currency: "USD", prices: new Map(Object.entries(prices)) });

/** Exact decimal comparison helper: compares string forms after rounding to `dp` places. */
export const near = (x: { toDecimalPlaces(dp: number): { toString(): string } } | null | undefined, dp = 12) => x?.toDecimalPlaces(dp).toString();
