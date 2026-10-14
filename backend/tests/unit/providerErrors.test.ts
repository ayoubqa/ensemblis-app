// Provider failures must be classified correctly from their messages — the
// readable ones llmProvider throws and the raw shapes from OpenAI, Groq and
// the Anthropic SDK — so a bad key or an exhausted quota is never retried as
// "most failures are temporary". Error text must never carry a key.
import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { classifyProviderError, isConfigError } from "../../src/ai/errors";
import { mapAnthropicError, quotaExhaustedMessage, waitFromErrorBody } from "../../src/ai/llmProvider";
import { redact } from "../../src/lib/log";

const anthropicError = (status: number, type: string, message: string, headers: Record<string, string> = {}) =>
  Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, headers);

describe("classifyProviderError: llmProvider's own messages", () => {
  it.each([
    ["The AI provider isn't configured: OPENAI_API_KEY is missing on the server.", "config"],
    ["The AI provider rejected the server's API key (invalid or revoked). (Owner: check OPENAI_API_KEY …)", "config"],
    ['The AI provider doesn\'t recognise the model "gpt-x" (check OPENAI_MODEL / OPENAI_FAST_MODEL).', "config"],
    ['Unknown AI_PROVIDER "gemini" — use "ollama", "openai" or "anthropic"', "config"],
    ['AI_PROVIDER="mock" is for development and tests only', "config"],
    [quotaExhaustedMessage(120_000), "quota"],
    [quotaExhaustedMessage(null, "the account behind ANTHROPIC_API_KEY"), "quota"],
    ["AI rate limit reached: the AI provider is throttling requests right now. Please try again in a minute.", "rate_limit"],
    ["This request is too large for the AI model's limits (provider request-size cap).", "too_large"],
    ["The AI model took too long to respond (over 120s). Please try again.", "transient"],
    ["The AI provider is having problems right now (HTTP 503). Please try again later.", "transient"],
    ["Could not reach the AI provider (ECONNREFUSED). Please try again.", "transient"],
    ["The connection to the AI provider was interrupted mid-response (terminated). Please try again.", "transient"],
    ["The AI model returned an empty response", "unknown"],
    ["", "unknown"],
  ])("%s → %s", (message, kind) => {
    expect(classifyProviderError(message)).toBe(kind);
  });

  it("the quota message names a wait and never says 'free'", () => {
    expect(quotaExhaustedMessage(120_000)).toMatch(/quota is exhausted.*retry after ~2 min/);
    expect(quotaExhaustedMessage(5 * 3600_000)).toMatch(/~5 h/);
    expect(quotaExhaustedMessage(120_000)).not.toMatch(/free/i);
  });

  it("accepts an Error as well as a string", () => {
    expect(classifyProviderError(new Error("The AI provider rejected the server's API key"))).toBe("config");
  });
});

describe("classifyProviderError: raw OpenAI and Groq shapes", () => {
  it.each([
    ["Incorrect API key provided: sk-proj-abc123. You can find your API key at https://platform.openai.com/account/api-keys.", "config"],
    ['{"error":{"message":"Invalid API Key","type":"invalid_request_error","code":"invalid_api_key"}}', "config"],
    ["The model `gpt-9` does not exist or you do not have access to it.", "config"],
    ['{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}', "quota"],
    ["Rate limit reached for gpt-4o in organization org-abc on tokens per min (TPM): Limit 30000, Used 29000, Requested 2000. Please try again in 2s.", "rate_limit"],
    // Groq appends a billing upgrade link to every rate-limit message: still a rate limit, not a quota.
    [
      "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7000, Requested 2000. Please try again in 7.5s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing",
      "rate_limit",
    ],
    [
      "Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199500, Requested 2000. Please try again in 7m12.5s.",
      "quota",
    ],
    [
      "Request too large for model `openai/gpt-oss-120b` in organization `org_01` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 12000, please reduce your message size and try again.",
      "too_large",
    ],
    ["This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.", "too_large"],
    ["fetch failed", "transient"],
  ])("%s → %s", (message, kind) => {
    expect(classifyProviderError(message)).toBe(kind);
  });

  it("reads the wait out of a rate-limit body", () => {
    expect(waitFromErrorBody("Please try again in 7m12.5s.")).toBe(432_500);
    expect(waitFromErrorBody("Please try again in 1h2m")).toBe(3_720_000);
    expect(waitFromErrorBody("Please try again in 850ms")).toBeNull();
    expect(waitFromErrorBody("no hint here")).toBeNull();
  });
});

describe("Anthropic SDK errors", () => {
  it.each([
    [anthropicError(401, "authentication_error", "invalid x-api-key"), "config", /rejected the server's API key.*ANTHROPIC_API_KEY/],
    [anthropicError(403, "permission_error", "Your API key does not have permission to use the specified resource."), "config", /rejected the server's API key/],
    [anthropicError(404, "not_found_error", "model: claude-x"), "config", /doesn't recognise the model "claude-test"/],
    [
      anthropicError(400, "invalid_request_error", "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."),
      "quota",
      /quota is exhausted/,
    ],
    [anthropicError(429, "rate_limit_error", "Number of request tokens has exceeded your per-minute rate limit"), "rate_limit", /rate limit reached/],
    [anthropicError(429, "rate_limit_error", "Rate limited", { "retry-after": "3600" }), "quota", /retry after ~60 min/],
    [anthropicError(413, "request_too_large", "Request exceeds the maximum allowed number of bytes."), "too_large", /too large/],
    [anthropicError(400, "invalid_request_error", "prompt is too long: 250000 tokens > 200000 maximum"), "too_large", /too large/],
    [anthropicError(529, "overloaded_error", "Overloaded"), "transient", /having problems right now \(HTTP 529\)/],
    [anthropicError(500, "api_error", "Internal server error"), "transient", /having problems/],
  ])("maps %s", (err, kind, message) => {
    const mapped = mapAnthropicError(err, "claude-test", 120_000);
    expect(mapped.message).toMatch(message);
    expect(classifyProviderError(mapped.message)).toBe(kind);
    // The raw SDK message ("401 {json}") classifies the same way — except when the deciding
    // signal is a header (a long Retry-After), which the message doesn't carry.
    if (!err.headers?.["retry-after"]) expect(classifyProviderError(err.message)).toBe(kind);
  });

  it("maps connection problems and timeouts to transient errors", () => {
    const conn = mapAnthropicError(new Anthropic.APIConnectionError({ message: "Connection error." }), "claude-test", 120_000);
    expect(conn.message).toMatch(/Could not reach the AI provider/);
    expect(classifyProviderError(conn.message)).toBe("transient");
    const slow = mapAnthropicError(new Anthropic.APIConnectionTimeoutError(), "claude-test", 120_000);
    expect(slow.message).toMatch(/took too long/);
    expect(classifyProviderError(slow.message)).toBe("transient");
  });

  it("never echoes a key from the provider's message", () => {
    const err = anthropicError(400, "invalid_request_error", "bad header x-api-key: sk-ant-api03-SECRETCANARY1234567890");
    const mapped = mapAnthropicError(err, "claude-test", 120_000);
    expect(mapped.message).not.toMatch(/SECRETCANARY/);
    expect(mapped.message).toMatch(/sk-ant-\[redacted\]/);
  });

  it("leaves non-SDK errors alone", () => {
    const e = new Error("something else");
    expect(mapAnthropicError(e, "claude-test")).toBe(e);
  });
});

describe("isConfigError", () => {
  it("is true for configuration and over-size requests, false for quota, rate limits and blips", () => {
    expect(isConfigError("The AI provider isn't configured: OPENAI_API_KEY is missing on the server.")).toBe(true);
    expect(isConfigError("This request is too large for the AI model's limits (provider request-size cap).")).toBe(true);
    expect(isConfigError(quotaExhaustedMessage(60_000))).toBe(false);
    expect(isConfigError("AI rate limit reached: the AI provider is throttling requests right now.")).toBe(false);
    expect(isConfigError("The AI model took too long to respond (over 120s).")).toBe(false);
  });
});

describe("redact", () => {
  it.each([
    ["key sk-abcdefghijklmnop1234 leaked", "key sk-[redacted] leaked"],
    ["key sk-proj-AbCdEf_123456-7890 leaked", "key sk-[redacted] leaked"],
    ["anthropic sk-ant-api03-abcdefgh_ijkl-mnop", "anthropic sk-ant-[redacted]"],
    ["groq gsk_ABCDEFGH12345678abcd", "groq gsk_[redacted]"],
    ["tavily tvly-SECRETCANARY123456", "tavily tvly-[redacted]"],
    ["Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig", "Authorization: Bearer [redacted]"],
    ["https://api.example.com/v1?api_key=abcd1234&x=1", "https://api.example.com/v1?api_key=[redacted]&x=1"],
  ])("%s", (input, output) => {
    expect(redact(input)).toBe(output);
  });

  it("leaves ordinary text, short tokens and words alone, and is idempotent", () => {
    const text = "Risk-assessment for task-runner sk-1 and the gsk_ prefix; Bearer x.";
    expect(redact(text)).toBe(text);
    const once = redact("sk-abcdefghijklmnop gsk_ABCDEFGH12345678 Bearer abcdefghijkl");
    expect(redact(once)).toBe(once);
    expect(redact("")).toBe("");
  });
});
