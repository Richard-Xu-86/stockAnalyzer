import { Decimal } from "decimal.js";

/** One configured Decimal for the whole domain: 40 significant digits, round half-even. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_EVEN });
export type Dec = InstanceType<typeof D>;

export const ZERO = new D(0);
export const ONE = new D(1);

export function dec(v: string | number | null | undefined): Dec | null {
  if (v === null || v === undefined || v === "") return null;
  try {
    const d = new D(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export const sum = (xs: Dec[]): Dec => xs.reduce((a, b) => a.plus(b), ZERO);
export const mean = (xs: Dec[]): Dec | null => (xs.length === 0 ? null : sum(xs).div(xs.length));
