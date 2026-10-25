/** Plain data shapes the domain works on. Money is decimal strings; no floats cross this boundary. */
export type Ccy = "CAD" | "USD";
export type BenchmarkId = "sp500" | "tsx";

export interface PositionRow {
  accountId: string;
  symbolKey: string;
  ticker: string;
  kind: string;
  units: string;
  price: string | null;
  multiplier: string;
  currency: string;
  costBasis: string | null;
}

export interface CashRow {
  accountId: string;
  currency: string;
  cash: string;
}

export interface Snapshot {
  date: string; // trading date (YYYY-MM-DD) whose close this represents
  status: "ok" | "stale" | "failed";
  accountIds: string[];
  transactionsSyncedMin: string | null;
  positions: PositionRow[];
  cash: CashRow[];
}

export interface ActivityRow {
  id: string;
  accountId: string;
  type: string;
  date: string;
  amount: string | null;
  currency: string | null;
}

/** CAD per 1 USD by date (Bank of Canada). */
export type FxSeries = ReadonlyMap<string, string>;

export interface BenchmarkSeries {
  id: BenchmarkId;
  ticker: string;
  currency: Ccy;
  prices: ReadonlyMap<string, string>;
}

export const BENCHMARKS: Record<BenchmarkId, { ticker: string; currency: Ccy; label: string; market: "NYSE" | "TSX" }> = {
  sp500: { ticker: "SPY", currency: "USD", label: "S&P 500", market: "NYSE" },
  tsx: { ticker: "XIC.TO", currency: "CAD", label: "TSX", market: "TSX" },
};
