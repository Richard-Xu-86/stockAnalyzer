/**
 * Scrubs API responses before they touch disk.
 * - IDs (UUIDs and ID-like keys) become stable pseudonyms, so joins such as
 *   external_reference_id and account IDs still line up within one run.
 * - Account names, numbers and emails are replaced.
 * - Long digit runs in free text (possible account numbers) are masked.
 * Money, dates, types and currencies are kept: they are what the spike measures.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/g;
const LONG_DIGITS = /\d{6,}/g;

const ID_KEYS = new Set(["id", "brokerage_authorization", "institution_account_id", "external_reference_id", "brokerage_order_id", "account_id", "authorization_id"]);
const REDACT_KEYS = new Set(["number", "email"]);
// "name" is personal only on account objects (recognised by a number or institution_name);
// on currencies, exchanges and symbols it is public reference data and is kept.
const isAccountLike = (o: Record<string, unknown>) => "number" in o || "institution_name" in o;

export class Scrubber {
  private readonly ids = new Map<string, string>();

  pseudonym(value: string): string {
    let alias = this.ids.get(value);
    if (!alias) {
      alias = `id-${String(this.ids.size + 1).padStart(4, "0")}`;
      this.ids.set(value, alias);
    }
    return alias;
  }

  scrub(value: unknown, key?: string): unknown {
    if (Array.isArray(value)) return value.map((v) => this.scrub(v));
    if (value !== null && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = k === "name" && typeof v === "string" && isAccountLike(obj) ? "REDACTED-NAME" : this.scrub(v, k);
      }
      return out;
    }
    if (typeof value !== "string") return value;
    if (key && REDACT_KEYS.has(key)) return `REDACTED-${key.toUpperCase()}`;
    if (key && ID_KEYS.has(key)) return this.pseudonym(value);
    return value
      .replace(UUID, (m) => this.pseudonym(m.toLowerCase()))
      .replace(EMAIL, "REDACTED-EMAIL")
      .replace(LONG_DIGITS, (m) => `${"#".repeat(m.length - 2)}${m.slice(-2)}`);
  }
}
