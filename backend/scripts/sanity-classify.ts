// Sanity check for task routing — no database or model needed.
//   npx tsx scripts/sanity-classify.ts
// Runs the real classifier against the seed catalog and prints the plan.

import { CATALOG } from "../src/catalog/agents";
import { classifyTask, Depth } from "../src/tasks/classify";

const agents = CATALOG.map((a) => ({ ...a, id: a.slug }));

const SAMPLES: [string, Depth][] = [
  ["I need a competitive analysis of the top 20 liquid cooling companies in Europe for an investment thesis.", "standard"],
  ["Find 100 qualified leads at Series A DevOps companies in the DACH region.", "focused"],
  ["Analyze our last 8 quarters of revenue and churn data and explain what changed.", "deep"],
  ["Review our Node.js repository for security vulnerabilities and performance problems.", "standard"],
  ["Build a Q4 marketing campaign plan for a B2B SaaS launch with a €40k budget.", "standard"],
  ["Build me a market-entry strategy for launching a B2B analytics product in Germany.", "deep"],
];

const eur = (c: number) => `€${(c / 100).toFixed(2)}`;

for (const [text, depth] of SAMPLES) {
  const e = classifyTask(text, agents, { depth });
  console.log(`\n> ${text}`);
  console.log(`  title:        ${e.title}`);
  console.log(`  category:     ${e.category}   depth: ${e.depth}`);
  console.log(`  lead:         ${e.leadAgent.name}`);
  console.log(`  alternatives: ${e.alternatives.map((a) => a.name).join(", ")}`);
  console.log(`  team:         ${e.team.map((s) => `${s.agent.name} [${s.role}]`).join(" -> ")}`);
  console.log(`  capabilities: ${e.capabilities.join(", ")}`);
  console.log(`  cost:         ${eur(e.costCents)}   time: ${e.estMinutesLow}–${e.estMinutesHigh} min   manual: ~${e.manualHoursEstimate} h`);
}

// Forced lead + dedupe checks
const forced = classifyTask("Write up our findings", agents, { depth: "deep", agentId: "verification-agent" });
console.log(`\nForced Verification Agent (deep): ${forced.team.map((s) => `${s.agent.name} [${s.role}]`).join(" -> ")}`);
const forcedReport = classifyTask("Write up our findings", agents, { depth: "standard", agentId: "report-agent" });
console.log(`Forced Report Agent (standard):   ${forcedReport.team.map((s) => `${s.agent.name} [${s.role}]`).join(" -> ")}`);
console.log(`\nCatalog: ${CATALOG.length} agents, ${new Set(CATALOG.map((a) => a.slug)).size} unique slugs`);
