import { writeFileSync } from "node:fs";
import { loadAllScenarios, loadBoc } from "./analyze/load.js";
import { renderFindings } from "./findings.js";

/** Offline: reads raw/, writes FINDINGS.md. Never calls the network. */
const scenarios = loadAllScenarios();
const boc = loadBoc();
if (scenarios.length === 0) console.warn("No scenarios in raw/. Run `npm run login` then `npm run collect` first.");
writeFileSync("FINDINGS.md", renderFindings(scenarios, boc, new Date().toISOString()));
console.log(`Wrote FINDINGS.md (${scenarios.length} scenario(s), ${boc.statuses.length} BoC series).`);
