import type { Activity, Account } from "../src/analyze/types.js";

/** Small hand-built activities: each one exists to exercise one branch. */
const usd = { code: "USD" };
const cad = { code: "CAD" };

export const act = (o: Partial<Activity> & { id: string }): Activity => ({ currency: cad, ...o }) as Activity;

export const ACTIVITIES: Activity[] = [
  // buy 10 @ 100, fee 9.99 inside amount: amount = -1009.99
  act({ id: "buy-fee-in", type: "BUY", units: 10, price: 100, fee: 9.99, amount: -1009.99, trade_date: "2026-03-02T00:00:00.000Z", external_reference_id: "ref-1" }),
  // sell 5 @ 50, fee 4.95 inside amount: amount = 250 - 4.95
  act({ id: "sell-fee-in", type: "SELL", units: -5, price: 50, fee: 4.95, amount: 245.05, trade_date: "2026-03-03T00:00:00.000Z" }),
  // buy with fee reported but not deducted from amount
  act({ id: "buy-fee-out", type: "BUY", units: 2, price: 10, fee: 1, amount: -20, trade_date: "2026-03-04T00:00:00.000Z" }),
  // commission-free buy, numbers as strings (shape check)
  act({ id: "buy-free", type: "BUY", units: "3", price: "33.333333", fee: "0", amount: "-99.999999", trade_date: "2026-03-05T00:00:00.000Z" }),
  // missing price
  act({ id: "buy-incomplete", type: "BUY", units: 1, price: null, fee: 0, amount: -5 }),
  // separate FEE row linked to buy-fee-in
  act({ id: "fee-linked", type: "FEE", amount: -9.99, external_reference_id: "ref-1", trade_date: "2026-03-02T00:00:00.000Z" }),
  // USD stock bought in a CAD account, rate quoted CAD per USD, on Saturday 2026-03-07
  act({ id: "fx-sat", type: "BUY", units: 1, price: 137, fee: 0, amount: -137, fx_rate: 1.37, trade_date: "2026-03-07T00:00:00.000Z", symbol: { id: "sym-aapl", symbol: "AAPL", currency: usd } }),
  // same but quoted USD per CAD (inverted)
  act({ id: "fx-inv", type: "BUY", units: 1, price: 138, fee: 0, amount: -138, fx_rate: 0.725, trade_date: "2026-03-09T00:00:00.000Z", symbol: { id: "sym-aapl", symbol: "AAPL", currency: usd } }),
  // nonsense rate: far from reference either way
  act({ id: "fx-bad", type: "BUY", units: 1, price: 2, fee: 0, amount: -2, fx_rate: 2.0, trade_date: "2026-03-09T00:00:00.000Z", symbol: { id: "sym-aapl", symbol: "AAPL", currency: usd } }),
  act({ id: "div", type: "DIVIDEND", amount: 10, trade_date: "2026-03-10T00:00:00.000Z", symbol: { id: "sym-aapl", symbol: "AAPL", currency: usd }, currency: usd }),
  act({ id: "tax", type: "TAX", amount: -1.5, trade_date: "2026-03-10T00:00:00.000Z", symbol: { id: "sym-aapl", symbol: "AAPL", currency: usd }, currency: usd }),
  act({ id: "acct-fee", type: "FEE", amount: -25, trade_date: "2026-03-11T00:00:00.000Z" }),
  act({ id: "odd", type: "BROKER_SPECIAL", amount: 1, trade_date: "2026-03-12T00:00:00.000Z" }),
];

// BoC FXUSDCAD, CAD per USD. No weekend entries; 2026-03-06 is the Friday before fx-sat.
export const USD_SERIES = new Map<string, string>([
  ["2026-03-05", "1.3650"],
  ["2026-03-06", "1.3700"],
  ["2026-03-09", "1.3780"],
]);

export const ACCOUNTS: Account[] = [
  { id: "a1", connectionId: "c1", institution_name: "Sandbox", raw_type: "Margin", account_category: "INVESTMENT", institution_account_id: "inst-9" } as Account,
  { id: "a2", connectionId: "c2", institution_name: "Sandbox", raw_type: "TFSA", account_category: "INVESTMENT", institution_account_id: "inst-9" } as Account,
];
