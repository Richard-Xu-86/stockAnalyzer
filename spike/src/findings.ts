import { ACCOUNT_FIELDS, ACTIVITY_FIELDS, endpointSummary, fieldPresence, rateLimitObservation } from "./analyze/o1-fields.js";
import { analyzeCommissions } from "./analyze/o2-commissions.js";
import { seriesCoverage } from "./analyze/o3-boc.js";
import { analyzeFx } from "./analyze/o4-fx.js";
import { analyzeRawTypes } from "./analyze/o5-account-types.js";
import { edgeCaseCoverage, summarise } from "./analyze/o6-coverage.js";
import type { BocLoad } from "./analyze/load.js";
import type { ScenarioData } from "./analyze/types.js";

/** Renders FINDINGS.md. Pure: same inputs, same document (except the passed-in timestamp). */
const table = (head: string[], rows: string[][]): string =>
  [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function renderFindings(scenarios: ScenarioData[], boc: BocLoad, generatedAt: string): string {
  const out: string[] = [`# Spike findings: O1–O6`, ``, `Generated ${generatedAt} from \`raw/\`. Scenarios: ${scenarios.map((s) => s.scenario).join(", ") || "(none collected)"}.`, ``, `Fill in every **Decision** line by hand after reading the evidence; the generator never decides.`, ``];

  const allActivities = scenarios.flatMap((s) => [...s.activitiesByAccount.values()].flat());
  const allAccounts = scenarios.flatMap((s) => s.accounts);

  // O1
  out.push(`## O1. Endpoints and fields on the OAuth path`, ``);
  for (const s of scenarios) {
    out.push(`### ${s.scenario}: endpoints`, ``);
    out.push(table(["Endpoint", "Statuses", "Max attempts", "Rate-limit headers seen"], endpointSummary(s.calls).map((e) => [cell(e.path), e.statuses.join(", "), String(e.maxAttempts), e.rateLimitHeaderNames.join(", ") || "none"])), ``);
    if (s.rateLimitProbe) {
      const r = rateLimitObservation(s.rateLimitProbe);
      out.push(`Rate-limit probe: ${r.requests} rapid requests; first 429 at request ${r.first429At ?? "never"}; Retry-After on 429: ${r.retryAfterOn429 ?? "absent"}; account-remaining sequence: ${r.accountRemainingSeen.join(" ")}.`, ``);
    }
    if (s.refreshProbe) out.push(`Refresh probe: refresh token rotated = ${s.refreshProbe.rotated}; id_token in refresh response = ${s.refreshProbe.idTokenPresent} (expected false).`, ``);
  }
  const fieldTable = (title: string, stats: ReturnType<typeof fieldPresence>) => [`### ${title}`, ``, table(["Field", "Records", "Missing key", "Null", "Types seen"], stats.map((f) => [`\`${f.field}\``, String(f.total), String(f.missing), String(f.nulls), f.types.join(", ") || "-"])), ``];
  out.push(...fieldTable("Activity fields (all scenarios)", fieldPresence(scenarios.flatMap((s) => s.rawActivities), ACTIVITY_FIELDS)));
  out.push(...fieldTable("Account fields (all scenarios)", fieldPresence(scenarios.flatMap((s) => s.rawAccounts), ACCOUNT_FIELDS)));
  out.push(`**Decision:** _paths confirmed / changed; fields that are strings not numbers; anything absent._`, ``);

  // O2
  const c = analyzeCommissions(allActivities);
  out.push(`## O2. Where commissions live`, ``);
  out.push(table(["Placement", "Trades"], Object.entries(c.counts).map(([k, v]) => [k, String(v)])), ``);
  out.push(`Trades with a linked FEE row: ${c.tradesWithLinkedFeeRow}. Trades with both a non-zero \`fee\` and a linked FEE row: ${c.tradesWithBothFeeAndLinkedRow}.`, ``);
  const odd = c.trades.filter((t) => t.placement === "unexplained" || t.placement === "incomplete").slice(0, 10);
  if (odd.length) out.push(table(["Activity", "Type", "fee", "amount + units×price", "Placement"], odd.map((t) => [t.id, t.type, t.fee ?? "-", t.residual ?? "-", t.placement])), ``);
  out.push(`**Decision:** _C1 reads \`fee\`; C2 applies / never seen; double-count guard needed or not. Sandbox is one simulated broker: real-broker behaviour stays open._`, ``);

  // O3
  out.push(`## O3. Bank of Canada rates`, ``);
  if (boc.statuses.length === 0) out.push(`No BoC data collected. Run \`npm run boc\`.`, ``);
  else {
    out.push(table(["Series", "HTTP", "Observations", "First", "Last", "Weekday gaps", "Weekend obs."], boc.statuses.map((st) => {
      const code = /^FX([A-Z]{3})CAD$/.exec(st.series)?.[1];
      const rates = code ? boc.series.get(code) : undefined;
      if (!rates) return [st.series, String(st.status), "-", "-", "-", st.error ?? "-", "-"];
      const cov = seriesCoverage(st.series, rates);
      return [st.series, String(st.status), String(cov.observations), cov.first ?? "-", cov.last ?? "-", cov.weekdayGaps.join(", ") || "none", String(cov.weekendObservations)];
    })), ``);
  }
  out.push(`**Decision:** _URL format confirmed; terms of use (attribution? limits?); prior-business-day rule holds; fallback source named._`, ``);

  // O4
  const fx = analyzeFx(allActivities, boc.series);
  out.push(`## O4. \`fx_rate\` presence and direction`, ``);
  if (fx.length === 0) out.push(`No activity in the collected data has \`fx_rate\` set. **Not verifiable from this data**: check FUNDS_CONVERSION activities (separate FX rows) and rely on the golden portfolio for rule C3.`, ``);
  else out.push(table(["Activity", "Date", "Acct ccy", "Security ccy", "fx_rate", "Verdict"], fx.map((r) => [r.id, r.date ?? "-", r.accountCurrency ?? "-", r.securityCurrency ?? "-", r.fxRate, verdictText(r.verdict)])), ``);
  out.push(`**Decision:** _orientation; whether the 5% threshold is right._`, ``);

  // O5
  out.push(`## O5. \`raw_type\` values`, ``);
  out.push(table(["Institution", "raw_type", "account_category", "Maps to", "Accounts"], analyzeRawTypes(allAccounts).map((r) => [cell(r.institution), cell(r.rawType), r.accountCategory, r.mapped, String(r.count)])), ``);
  out.push(`**Decision:** _seed lookup table; reply from support@snaptrade.com on TFSA/RRSP strings._`, ``);

  // O6
  out.push(`## O6. What the collected data covers`, ``);
  for (const s of scenarios) {
    const sum = summarise(s.accounts, [...s.activitiesByAccount.values()].flat());
    out.push(`### ${s.scenario}`, ``, `${s.accounts.length} accounts, ${sum.activityCount} activities, currencies ${sum.currencies.join(", ") || "none"}, dates ${sum.firstDate ?? "-"} to ${sum.lastDate ?? "-"}.`, ``);
    out.push(table(["Type", "Count"], Object.entries(sum.byType).map(([k, v]) => [k, String(v)])), ``);
    out.push(table(["Account", "first_transaction_date", "initial_sync_completed", "last_successful_sync"], sum.accounts.map((a) => [a.id, a.firstTransactionDate ?? "-", String(a.initialSyncCompleted ?? "-"), a.lastSuccessfulSync ?? "-"])), ``);
  }
  out.push(`### Golden-portfolio edge cases`, ``);
  out.push(table(["Case", "What", "Covered by collected data"], edgeCaseCoverage(allActivities, allAccounts).map((e) => [e.id, e.label, e.coveredBySandbox ? "yes" : "no: golden portfolio only"])), ``);
  out.push(`**Decision:** _which tests may rely on recorded Sandbox fixtures; whether dates drift day to day (re-pull and diff)._`, ``);

  return `${out.join("\n")}\n`;
}

function verdictText(v: ReturnType<typeof analyzeFx>[number]["verdict"]): string {
  switch (v.kind) {
    case "usable":
      return `usable, ${v.orientation}, deviation ${v.deviation}${v.substituted ? ` (rate from ${v.rateDate})` : ""}`;
    case "beyond_threshold":
      return `beyond 5% (best ${v.bestDeviation})`;
    case "no_reference":
      return `no reference: ${v.reason}`;
    case "invalid_rate":
      return "invalid rate";
  }
}
