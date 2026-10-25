import { addDays, isAnyMarketOpen } from "@/lib/calendar";
import { D, type Dec } from "@/domain/decimal";
import type { ActivityRow, CashRow, PositionRow, Snapshot } from "@/domain/types";

/**
 * Deterministic sample history for demo mode: two fictional accounts over 40 trading days, with
 * one of each hard case: a deposit, a withdrawal, a transfer in transit, a stock split, an account
 * added mid-history, a missed run, a partial snapshot and real market holidays (Canada Day, July 4th
 * observed, Civic Holiday). Prices are a seeded random walk: no real data, no market-data licence.
 */
export const DEMO_END = "2026-08-28";
const DAYS = 40;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function tradingDates(end: string, n: number): string[] {
  const out: string[] = [];
  for (let d = end; out.length < n; d = addDays(d, -1)) if (isAnyMarketOpen(d)) out.unshift(d);
  return out;
}

interface Walk {
  ticker: string;
  start: number;
  vol: number;
  beta: number;
  currency: "CAD" | "USD";
  market: "us" | "ca";
}

const HOLDINGS: Walk[] = [
  { ticker: "MAPL", start: 84, vol: 0.016, beta: 1.2, currency: "CAD", market: "ca" },
  { ticker: "NRTH", start: 41, vol: 0.012, beta: 0.8, currency: "CAD", market: "ca" },
  { ticker: "ORBT", start: 212, vol: 0.022, beta: 1.5, currency: "USD", market: "us" },
  { ticker: "PIXL", start: 58, vol: 0.019, beta: 1.1, currency: "USD", market: "us" },
  { ticker: "QUAY", start: 33, vol: 0.01, beta: 0.6, currency: "USD", market: "us" },
];

export interface DemoData {
  snapshots: Snapshot[];
  activities: ActivityRow[];
  fx: Map<string, string>;
  benchmarks: { sp500: Map<string, string>; tsx: Map<string, string> };
}

const money = (x: Dec) => x.toDecimalPlaces(2).toString();
const px = (x: Dec) => x.toDecimalPlaces(4).toString();

export function demoData(): DemoData {
  const rnd = lcg(20260828);
  const dates = tradingDates(DEMO_END, DAYS);
  const fx = new Map<string, string>();
  const spy = new Map<string, string>();
  const xic = new Map<string, string>();
  const prices = new Map<string, Dec>(HOLDINGS.map((h) => [h.ticker, new D(h.start)]));
  let spyP = new D(642.1);
  let xicP = new D(41.85);
  let usdcad = new D("1.3712");
  const snapshots: Snapshot[] = [];
  const activities: ActivityRow[] = [];
  const units = new Map<string, Dec>([["MAPL", new D(60)], ["NRTH", new D(150)], ["ORBT", new D(12)], ["PIXL", new D(40)], ["QUAY", new D(90)]]);
  let cashTfsa = new D(1250);
  const cashUsd = new D(420);

  dates.forEach((date, i) => {
    const us = (rnd() - 0.48) * 0.018;
    const ca = (rnd() - 0.48) * 0.014;
    if (i > 0) {
      spyP = spyP.times(1 + us);
      xicP = xicP.times(1 + ca);
      usdcad = usdcad.times(1 + (rnd() - 0.5) * 0.004);
      for (const h of HOLDINGS) {
        const m = h.market === "us" ? us : ca;
        prices.set(h.ticker, prices.get(h.ticker)!.times(1 + h.beta * m + (rnd() - 0.5) * h.vol));
      }
    }
    // The Bank of Canada does not publish on Canadian holidays; the rate is simply absent.
    if (date !== "2026-07-01" && date !== "2026-08-03") fx.set(date, usdcad.toDecimalPlaces(4).toString());
    spy.set(date, px(spyP));
    xic.set(date, px(xicP));

    // Hard cases on fixed days.
    if (i === 7) {
      cashTfsa = cashTfsa.plus(2000);
      activities.push({ id: "dep-1", accountId: "demo-tfsa", type: "CONTRIBUTION", date, amount: "2000", currency: "CAD" });
    }
    if (i === 11) {
      units.set("PIXL", units.get("PIXL")!.times(2)); // 2-for-1 split: value unchanged
      prices.set("PIXL", prices.get("PIXL")!.div(2));
    }
    if (i === 14) {
      cashTfsa = cashTfsa.minus(500);
      activities.push({ id: "xfer-out", accountId: "demo-tfsa", type: "INTERNAL_CASH_TRANSFER_OUT", date, amount: "-500", currency: "CAD" });
    }
    if (i === 16) {
      activities.push({ id: "xfer-in", accountId: "demo-cash", type: "INTERNAL_CASH_TRANSFER_IN", date, amount: "500", currency: "CAD" });
    }
    if (i === 20) {
      cashTfsa = cashTfsa.minus(800);
      activities.push({ id: "wd-1", accountId: "demo-tfsa", type: "WITHDRAWAL", date, amount: "-800", currency: "CAD" });
    }

    const positions: PositionRow[] = HOLDINGS.map((h) => ({
      accountId: h.currency === "CAD" ? "demo-tfsa" : "demo-usd",
      symbolKey: h.ticker,
      ticker: h.ticker,
      kind: "stock",
      units: units.get(h.ticker)!.toString(),
      price: px(prices.get(h.ticker)!),
      multiplier: "1",
      currency: h.currency,
      costBasis: money(units.get(h.ticker)!.times(h.start)),
    }));
    // Day 33: an option the broker did not price; small enough to keep coverage above 90%.
    if (i === 33) positions.push({ accountId: "demo-usd", symbolKey: "ORBT-C", ticker: "ORBT call", kind: "option", units: "1", price: null, multiplier: "100", currency: "USD", costBasis: "310" });

    const accountIds = ["demo-tfsa", "demo-usd", ...(i >= 15 ? ["demo-cash"] : [])]; // cash account added on day 15
    const cash: CashRow[] = [
      { accountId: "demo-tfsa", currency: "CAD", cash: money(cashTfsa) },
      { accountId: "demo-usd", currency: "USD", cash: money(cashUsd) },
      ...(i >= 15 ? [{ accountId: "demo-cash", currency: "CAD", cash: i >= 16 ? "500.00" : "0.00" }] : []),
    ];
    if (i === 29) return; // missed run: no snapshot that day
    // The last day is provisional: its deposits have not synced yet (activities lag a day).
    snapshots.push({ date, status: "ok", accountIds, transactionsSyncedMin: i === DAYS - 1 ? addDays(date, -1) : date, positions, cash });
    // Seed earlier history for the day-one panel.
    if (i === 0) {
      activities.push(
        { id: "h-dep-1", accountId: "demo-tfsa", type: "CONTRIBUTION", date: "2025-11-14", amount: "5000", currency: "CAD" },
        { id: "h-dep-2", accountId: "demo-usd", type: "CONTRIBUTION", date: "2026-01-09", amount: "3000", currency: "USD" },
        { id: "h-buy-1", accountId: "demo-tfsa", type: "BUY", date: "2025-11-17", amount: "-5040", currency: "CAD" },
        { id: "h-buy-2", accountId: "demo-usd", type: "BUY", date: "2026-01-12", amount: "-2544", currency: "USD" },
        { id: "h-dep-3", accountId: "demo-tfsa", type: "CONTRIBUTION", date: "2026-03-02", amount: "1500", currency: "CAD" },
        { id: "h-sell-1", accountId: "demo-usd", type: "SELL", date: "2026-04-21", amount: "610", currency: "USD" },
      );
    }
  });

  return { snapshots, activities, fx, benchmarks: { sp500: spy, tsx: xic } };
}
