// A local stand-in for Groq's OpenAI-compatible Chat Completions API, for
// production-like runs without network access (E2E with PROD_LIKE=1) and for
// the provider wire tests (tests/unit/providerWire.test.ts). By default it
// answers with the deterministic mock model's text, but over the real wire
// format the production provider code parses: SSE chunks, a gpt-oss style
// `reasoning` delta first (which must be ignored), `finish_reason`, and usage
// in `x_groq.usage` on the final chunk.
//
// Scripted mode: `script` is a list of responses consumed in order (FIFO),
// one per request; once it is empty, requests get the default success.
// Each entry may set:
//   status          HTTP status (default 200). Non-2xx sends `body` as the error body.
//   retryAfter      Retry-After header value (string or number of seconds).
//   body            error body for a non-2xx status (object → JSON, string as is).
//   text            the reply content for a 200 (instead of the mock model's text).
//   hangMs          wait this long before answering (to exercise timeouts).
//   resetConnection destroy the socket before sending anything (a connection reset).
//   closeMidStream  destroy the socket after the first content chunk.
//   finish          finish_reason on the final chunk (default "stop"; "length" = truncated).
//   noUsage         omit x_groq.usage (the client must then estimate tokens).
//
//   node scripts/openai-stub.mjs [port]      (needs `npm run build` first for the mock text)
//   OPENAI_STUB_SCRIPT='[{"status":503,"retryAfter":0}]' node scripts/openai-stub.mjs
//
// Options: { script?, reply?(system, user, purpose) → string }. `reply`
// replaces the mock model (so tests need no build); requests() lists every
// request body received.

import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let mockLLM = null;
/** The built mock model, loaded on first use (only the default success path needs it). */
function mockText(system, user, purpose) {
  if (!mockLLM) mockLLM = require("../dist/ai/mockProvider.js").mockLLM;
  return mockLLM(system, user, { purpose });
}

/** The mock answers by purpose; the wire protocol doesn't carry it, so infer it from the system prompt. */
export function purposeOf(system) {
  if (/^You are the Chief of Staff/.test(system)) return "plan";
  if (/^You are the verification lead/.test(system)) return "verify";
  if (/^You check whether cited sources support/.test(system)) return "verify_claims";
  if (/^You maintain the operational memory/.test(system)) return "memory";
  if (/^You help a business define an objective/.test(system)) return "suggest";
  if (/^You plan research/.test(system)) return "queries";
  return "step";
}

function scriptFromEnv() {
  const raw = process.env.OPENAI_STUB_SCRIPT;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    console.warn("[openai-stub] OPENAI_STUB_SCRIPT is not valid JSON — ignored");
    return [];
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startOpenAIStub(port = 0, opts = {}) {
  let calls = 0;
  const script = Array.isArray(opts.script) ? [...opts.script] : scriptFromEnv();
  const requests = [];
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
      const step = script.length ? script.shift() || {} : {};
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: "invalid JSON body" } }));
        return;
      }
      requests.push(payload);
      if (step.hangMs) await sleep(step.hangMs);
      if (res.destroyed || req.socket.destroyed) return; // the client gave up (timeout)
      if (step.resetConnection) {
        req.socket.destroy();
        return;
      }
      const status = step.status ?? 200;
      const headers = {};
      if (step.retryAfter !== undefined && step.retryAfter !== null) headers["Retry-After"] = String(step.retryAfter);
      if (status < 200 || status >= 300) {
        const errBody = typeof step.body === "string" ? step.body : JSON.stringify(step.body ?? { error: { message: `stub error ${status}` } });
        res.writeHead(status, { "Content-Type": typeof step.body === "string" ? "text/plain" : "application/json", ...headers }).end(errBody);
        return;
      }

      const system = payload.messages?.find((m) => m.role === "system")?.content ?? "";
      const user = payload.messages?.find((m) => m.role === "user")?.content ?? "";
      const purpose = purposeOf(system);
      const text = typeof step.text === "string" ? step.text : opts.reply ? opts.reply(system, user, purpose) : mockText(system, user, purpose);
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...headers });
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const id = `chatcmpl-stub-${calls}`;
      send({ id, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { role: "assistant", reasoning: "Let me think about the {objective} first." } }] });
      const chunks = [];
      for (let i = 0; i < text.length; i += 400) chunks.push(text.slice(i, i + 400));
      // OPENAI_STUB_DELAY_MS spreads a step's reply out so a browser test can watch it run.
      const delay = purpose === "step" ? Number(process.env.OPENAI_STUB_DELAY_MS) || 0 : 0;
      for (const piece of chunks) {
        send({ id, object: "chat.completion.chunk", model: payload.model, choices: [{ index: 0, delta: { content: piece } }] });
        if (step.closeMidStream) {
          // Let the chunk reach the client, then cut the connection.
          await sleep(20);
          req.socket.destroy();
          return;
        }
        if (delay) await sleep(delay / chunks.length);
      }
      send({
        id,
        object: "chat.completion.chunk",
        model: payload.model,
        choices: [{ index: 0, delta: {}, finish_reason: step.finish ?? "stop" }],
        ...(step.noUsage
          ? {}
          : { x_groq: { usage: { prompt_tokens: Math.ceil((system.length + user.length) / 4), completion_tokens: Math.ceil(text.length / 4) } } }),
      });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        port: server.address().port,
        calls: () => calls,
        requests: () => requests,
        /** Appends scripted responses (consumed before the default success). */
        push: (...steps) => script.push(...steps),
        /** Drops the scripted responses not yet consumed. */
        clear: () => {
          script.length = 0;
        },
        close: () => new Promise((r) => server.close(() => r())),
      })
    )
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startOpenAIStub(Number(process.argv[2]) || 4199);
  console.log(`OpenAI-compatible stub on http://127.0.0.1:${port}/v1`);
}
