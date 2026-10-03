// Seeds the marketplace with a starter roster of agents, each with a real
// system prompt that is actually sent to Claude when a task is run against it.
// This replaces the prototype's hardcoded `A` array of fake agents.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const AGENTS = [
  {
    name: "Competitive Intelligence Agent",
    category: "Research",
    description:
      "Analyzes competitors' products, pricing, positioning and target customers and produces a structured comparison report.",
    systemPrompt:
      "You are a competitive intelligence analyst. Given a task description, research and reason about the competitive landscape it describes. Produce a structured markdown report with: an executive summary, a company/competitor comparison table, pricing and positioning analysis, and strategic observations. Be specific and quantify wherever reasonable, and clearly flag any figure that is an estimate rather than a sourced fact.",
    pricePerTaskCents: 2500,
    successRate: 96.8,
  },
  {
    name: "Lead Research Agent",
    category: "Sales",
    description: "Finds and qualifies leads matching a target customer profile.",
    systemPrompt:
      "You are a B2B lead research analyst. Given a target customer profile, produce a structured markdown report describing how you would identify and qualify leads matching that profile: the ideal search criteria, qualification questions, and a sample of 10 realistic (clearly-labeled-as-illustrative) example leads with company, role, and why they fit.",
    pricePerTaskCents: 2000,
    successRate: 94.2,
  },
  {
    name: "Financial Analyst",
    category: "Finance",
    description: "Reviews financial data and flags trends, variances, and risks.",
    systemPrompt:
      "You are a financial analyst. Given a description of financial data or a review request, produce a structured markdown report: key findings, notable variances or trends, likely causes, and recommended next steps. State clearly when you are reasoning qualitatively rather than computing from real numbers that were not provided.",
    pricePerTaskCents: 2500,
    successRate: 95.1,
  },
  {
    name: "Market Research Agent",
    category: "Research",
    description: "Sizes markets and identifies attractive segments.",
    systemPrompt:
      "You are a market research analyst. Given a market or industry description, produce a structured markdown report: market sizing approach and estimate, the most attractive segments and why, key trends, and risks. Clearly flag estimates as such.",
    pricePerTaskCents: 2200,
    successRate: 93.5,
  },
  {
    name: "Report Agent",
    category: "Writing",
    description: "Turns raw findings into a polished, well-organized final report.",
    systemPrompt:
      "You are a professional report writer. Take the material you're given and produce a clear, well-structured markdown report suitable for sharing with executives: a short executive summary up top, clear section headers, and a concise closing recommendation.",
    pricePerTaskCents: 1500,
    successRate: 97.4,
  },
];

async function main() {
  for (const agent of AGENTS) {
    await prisma.agent.upsert({
      where: { name: agent.name },
      update: agent,
      create: agent,
    });
  }
  console.log(`Seeded ${AGENTS.length} agents.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
