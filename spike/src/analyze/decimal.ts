// Named import: decimal.js ships an ESM build exporting `Decimal`, which NodeNext types correctly.
import { Decimal } from "decimal.js";

/** Parse an API number or numeric string to Decimal; null for missing or unparseable. */
export function dec(v: unknown): Decimal | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  try {
    const d = new Decimal(v);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

export { Decimal };
