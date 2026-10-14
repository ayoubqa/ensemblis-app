// A local stand-in for Groq's OpenAI-compatible Chat Completions API, for
// production-like runs without network access (E2E with PROD_LIKE=1). It
// answers with the deterministic mock model's text, but over the real wire
// format the production provider code parses: SSE chunks, a gpt-oss style
// `reasoning` delta first (which must be ignored), `finish_reason`, and usage
// in `x_groq.usage` on the final chunk.
//
//   node scripts/openai-stub.mjs [port]      (needs `npm run build` first)

import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { mockLLM } = require("../dist/ai/mockProvider.js");

/** The mock answers by purpose; the wire protocol doesn't carry it, so infer it from the system prompt. */
function purposeOf(system) {
  if (/^You are the Chief of Staff/.test(system)) return "plan";
  if (/^You are the verification lead/.test(system)) return "verify";
  if (/^You maintain the operational memory/.test(system)) return "memory";
  if (/^You help a business define an objective/.test(system)) return "suggest";
  if (/^You plan research/.test(system)) return "queries";
  return "step";
}

export function startOpenAIStub(port = 0) {
  let calls = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    if (!/^Bearer \S+/.test(req.headers.authorization || "")) {
      res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "missing key" } }));
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      calls++;
      const payload = JSON.parse(body);
      const system = payload.messages.find((m) => m.role === "system")?.content ?? "";
      const user = payload.messages.find((m) => m.role === "user")?.content ?? "";
      const text = mockLLM(system, user, { purpose: purposeOf(system) });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const id = `chatcmpl-stub-${calls}`;
      send({ id, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { role: "assistant", reasoning: "Let me think about the {objective} first." } }] });
      const chunks = [];
      for (let i = 0; i < text.length; i += 400) chunks.push(text.slice(i, i + 400));
      // OPENAI_STUB_DELAY_MS spreads a step's reply out so a browser test can watch it run.
      const delay = purposeOf(system) === "step" ? Number(process.env.OPENAI_STUB_DELAY_MS) || 0 : 0;
      for (const piece of chunks) {
        send({ id, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { content: piece } }] });
        if (delay) await new Promise((r) => setTimeout(r, delay / chunks.length));
      }
      send({
        id,
        object: "chat.completion.chunk",
        model: payload.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        x_groq: { usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(text.length / 4) } },
      });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, calls: () => calls })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startOpenAIStub(Number(process.argv[2]) || 4199);
  console.log(`OpenAI-compatible stub on http://127.0.0.1:${port}/v1`);
}
