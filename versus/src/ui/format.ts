import type { Dec } from "@/domain/decimal";
import type { Ccy } from "@/domain/types";

/** Display formatting only. Maths stays in decimals; numbers are rounded here, at the edge. */
const MINUS = "−";

export function pct(x: Dec | null | undefined, dp = 2): string {
  if (x === null || x === undefined) return "–";
  const v = x.times(100).toDecimalPlaces(dp);
  if (v.isZero()) return `0.${"0".repeat(dp)}%`;
  return `${v.isNegative() ? MINUS : "+"}${v.abs().toFixed(dp)}%`;
}

/** Percentage points, for differences between two returns. */
export function pts(x: Dec | null | undefined, dp = 2): string {
  if (x === null || x === undefined) return "–";
  const v = x.times(100).toDecimalPlaces(dp);
  if (v.isZero()) return `0.${"0".repeat(dp)} pts`;
  return `${v.isNegative() ? MINUS : "+"}${v.abs().toFixed(dp)} pts`;
}

export function ratio(x: Dec | null | undefined): string {
  return x === null || x === undefined ? "–" : x.toDecimalPlaces(2).toFixed(2);
}

export function money(x: Dec | null | undefined, ccy: Ccy): string {
  if (x === null || x === undefined) return "–";
  const n = Number(x.toDecimalPlaces(2).toString());
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: ccy, currencyDisplay: "narrowSymbol", minimumFractionDigits: 2 }).format(n).replace("-", MINUS) + ` ${ccy}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function day(iso: string, withWeekday = false): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${withWeekday ? `${wd} ` : ""}${MONTHS[m - 1]} ${d}, ${y}`;
}

export const shortDay = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
};

export const month = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
};

export const isLoss = (x: Dec | null | undefined) => !!x && x.isNegative() && !x.toDecimalPlaces(4).isZero();
