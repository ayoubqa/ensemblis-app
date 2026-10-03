// A tiny abstraction so agentRunner.ts doesn't care which model actually
// writes the report. Two providers are wired up:
//
//   - "ollama"    (default, free): a local open-source model via Ollama.
//                 No account, no payment, nothing leaves your machine.
//   - "anthropic" (paid): the real Claude API, once you're ready to pay for
//                 noticeably better output quality.
//
// Switch between them with AI_PROVIDER in backend/.env — no code changes.

import Anthropic from "@anthropic-ai/sdk";

export interface LLMResult {
  text: string;
}

async function runWithOllama(systemPrompt: string, userContent: string): Promise<LLMResult> {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  // llama3.2 is small and fast enough to run on a laptop CPU. Swap in a
  // bigger pulled model (e.g. llama3.1, mistral) via OLLAMA_MODEL if your
  // machine can handle it and you want better output quality.
  const model = process.env.OLLAMA_MODEL || "llama3.2";

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (err) {
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is it running? Start it with \`ollama serve\` ` +
        `(or just open the Ollama app), and make sure you've run \`ollama pull ${model}\` at least once. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama returned ${res.status}: ${body || res.statusText}`);
  }

  const data = (await res.json()) as { message?: { content?: string } };
  const text = data.message?.content;
  if (!text) throw new Error("Ollama returned an empty response");
  return { text };
}

async function runWithAnthropic(systemPrompt: string, userContent: string): Promise<LLMResult> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Defaults to Haiku — the cheapest current model. Bump via CLAUDE_MODEL
  // once quality matters more than cost. See
  // https://docs.claude.com/en/docs/about-claude/models/overview
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";

  const message = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");

  return { text };
}

export async function runLLM(systemPrompt: string, userContent: string): Promise<LLMResult> {
  const provider = (process.env.AI_PROVIDER || "ollama").toLowerCase();
  if (provider === "anthropic") return runWithAnthropic(systemPrompt, userContent);
  if (provider === "ollama") return runWithOllama(systemPrompt, userContent);
  throw new Error(`Unknown AI_PROVIDER "${provider}" — use "ollama" or "anthropic"`);
}
