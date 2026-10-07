// Tool definitions — what an agent may use while executing a capability.
//
// Every tool declares a permission level. The execution policy (org/policy.ts)
// only grants READ_ONLY tools in this release, so nothing can send email,
// publish, change CRM records, spend money or delete anything on its own. A
// future write-capable tool is added here with its permission level and is
// then blocked (or routed through an ACTION approval) by the policy — no
// change to the executor is needed.
//
// `trust` says how the executor must treat the tool's output in prompts:
//   - "internal":       produced by Ensemblis itself (e.g. confirmed memory)
//   - "user_provided":  entered by the organization (company context)
//   - "untrusted":      external pages, search results, uploaded documents —
//                       quoted as data, never followed as instructions.

export type ToolPermission = "READ_ONLY" | "WRITE" | "EXTERNAL_ACTION" | "FINANCIAL" | "DESTRUCTIVE";
export type ToolTrust = "internal" | "user_provided" | "untrusted";

export type ToolKey = "company_context" | "memory" | "documents" | "web_research" | "website";

export interface ToolDefinition {
  key: ToolKey;
  name: string;
  description: string;
  permission: ToolPermission;
  trust: ToolTrust;
  version: string;
}

export const TOOLS: Record<ToolKey, ToolDefinition> = {
  company_context: {
    key: "company_context",
    name: "Company context",
    description: "Reads the organization's company profile: products, customers/ICP, markets, business model and goals.",
    permission: "READ_ONLY",
    trust: "user_provided",
    version: "1.0.0",
  },
  memory: {
    key: "memory",
    name: "Business memory",
    description: "Reads confirmed operational memory: preferences, decisions, lessons and constraints.",
    permission: "READ_ONLY",
    trust: "internal",
    version: "1.0.0",
  },
  documents: {
    key: "documents",
    name: "Document retrieval",
    description: "Retrieves the most relevant passages from the organization's uploaded documents.",
    permission: "READ_ONLY",
    trust: "untrusted",
    version: "1.0.0",
  },
  web_research: {
    key: "web_research",
    name: "Web research",
    description: "Runs web searches (Tavily, or Wikipedia when no key is set) and reads the result extracts.",
    permission: "READ_ONLY",
    trust: "untrusted",
    version: "1.0.0",
  },
  website: {
    key: "website",
    name: "Company website",
    description: "Reads the organization's public website (fetched server-side with SSRF protection).",
    permission: "READ_ONLY",
    trust: "untrusted",
    version: "1.0.0",
  },
};

export const TOOL_PERMISSION_LEVELS: ToolPermission[] = ["READ_ONLY", "WRITE", "EXTERNAL_ACTION", "FINANCIAL", "DESTRUCTIVE"];
