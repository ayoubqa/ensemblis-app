// CORS is an exact-match allow-list. A site served from an origin that isn't on it gets no
// Access-Control-Allow-Origin header, the browser refuses the response, and the page only sees a failed
// fetch ("Can't reach the Ensemblis server") while /health stays green. These tests pin that behaviour
// and the log line that makes it visible on the server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { log } from "../../src/lib/log";
import { resetRejectedOriginsForTests } from "../../src/lib/cors";
import { parseCorsOrigins } from "../../src/lib/corsOrigins";
import { api, createUser } from "../helpers";

const ALLOWED = "http://localhost:3000"; // the test default (CORS_ORIGIN unset)
const CUSTOM_DOMAIN = "https://www.getensemblis.com";

describe("CORS allow-list", () => {
  beforeEach(() => resetRejectedOriginsForTests());

  it("answers an allowed origin with Access-Control-Allow-Origin, for the preflight and the request", async () => {
    expect(config.corsOrigins).toContain(ALLOWED);
    const pre = await api().options("/api/auth/login").set("Origin", ALLOWED).set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "content-type");
    expect(pre.headers["access-control-allow-origin"]).toBe(ALLOWED);
    const res = await api().post("/api/auth/login").set("Origin", ALLOWED).send({ email: "nobody@example.com", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(ALLOWED);
  });

  it("a site on an origin that isn't listed (e.g. a new custom domain) gets no CORS headers, and the server logs why once", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    for (let i = 0; i < 3; i++) {
      const pre = await api().options("/api/auth/login").set("Origin", CUSTOM_DOMAIN).set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "content-type");
      expect(pre.headers["access-control-allow-origin"]).toBeUndefined(); // the browser will refuse the login POST
    }
    const rejected = warn.mock.calls.filter((c) => c[0] === "cors.origin_rejected");
    expect(rejected).toHaveLength(1); // once per origin, not once per request
    expect(rejected[0][1]).toMatchObject({ origin: CUSTOM_DOMAIN, allowedOrigins: config.corsOrigins });
    expect(String((rejected[0][1] as { hint: string }).hint)).toMatch(/add the exact origin.*CORS_ORIGIN.*www and the bare domain are different origins/);
    warn.mockRestore();
  });

  it("www and the bare domain are different origins; a trailing slash is ignored", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    config.corsOrigins.push("https://getensemblis.com");
    try {
      const apex = await api().get("/health/live").set("Origin", "https://getensemblis.com/");
      expect(apex.headers["access-control-allow-origin"]).toBe("https://getensemblis.com/");
      const www = await api().get("/health/live").set("Origin", "https://www.getensemblis.com");
      expect(www.headers["access-control-allow-origin"]).toBeUndefined();
    } finally {
      config.corsOrigins.pop();
      warn.mockRestore();
    }
  });

  it("requests without an Origin (curl, health checks) are allowed and never logged; the log stays bounded", async () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    expect((await api().get("/health/live")).status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    // Anyone can send any Origin: a long one is cut, and only a bounded number of distinct origins are remembered.
    await api().get("/health/live").set("Origin", `https://${"a".repeat(500)}.test`);
    expect(String((warn.mock.calls[0][1] as { origin: string }).origin).length).toBeLessThanOrEqual(200);
    for (let i = 0; i < 80; i++) await api().get("/health/live").set("Origin", `https://site-${i}.test`);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(50);
    warn.mockRestore();
  });
});

// The production domains. CORS_ORIGIN is applied through the same parser config.ts uses at boot.
describe("production origins", () => {
  const VERCEL = "https://ensemblis-app.vercel.app";
  const WWW = "https://www.getensemblis.com";
  const APEX = "https://getensemblis.com";
  const INCIDENT = `${VERCEL},https//www.getensemblis.com`; // what Render held: the colon is missing in the second entry
  const CORRECTED = `${WWW},${APEX},${VERCEL}`;

  let original: string[];
  beforeEach(() => {
    resetRejectedOriginsForTests();
    original = [...config.corsOrigins];
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    config.corsOrigins.splice(0, config.corsOrigins.length, ...original);
    vi.restoreAllMocks();
  });
  const useCorsOrigin = (value: string) => config.corsOrigins.splice(0, config.corsOrigins.length, ...parseCorsOrigins(value).origins);
  const preflight = (origin: string) =>
    api().options("/api/auth/login").set("Origin", origin).set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "authorization,content-type");

  it("with the value that was live, the Vercel origin works and www is refused (the reported symptom)", async () => {
    useCorsOrigin(INCIDENT);
    expect(config.corsOrigins).toEqual([VERCEL]);
    expect((await preflight(VERCEL)).headers["access-control-allow-origin"]).toBe(VERCEL);
    expect((await preflight(WWW)).headers["access-control-allow-origin"]).toBeUndefined();
    expect((await preflight(APEX)).headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each([WWW, APEX, VERCEL])("with the corrected value, %s passes the preflight with credentials and the headers the app sends", async (origin) => {
    useCorsOrigin(CORRECTED);
    const res = await preflight(origin);
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(origin);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
    expect(res.headers["access-control-allow-headers"]?.toLowerCase()).toMatch(/authorization/);
    expect(res.headers["access-control-allow-headers"]?.toLowerCase()).toMatch(/content-type/);
    expect(res.headers["vary"]).toMatch(/Origin/i);
  });

  it.each([WWW, APEX, VERCEL])("a real login from %s gets a token the browser is allowed to read; a wrong password is a readable 401, not a network failure", async (origin) => {
    useCorsOrigin(CORRECTED);
    const { user } = await createUser({ email: `login-${Date.now()}@example.com` });
    const ok = await api().post("/api/auth/login").set("Origin", origin).send({ email: user.email, password: "password123" });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toBeTruthy();
    expect(ok.headers["access-control-allow-origin"]).toBe(origin);
    const bad = await api().post("/api/auth/login").set("Origin", origin).send({ email: user.email, password: "not-the-password" });
    expect(bad.status).toBe(401);
    expect(bad.headers["access-control-allow-origin"]).toBe(origin);
  });

  it("refuses look-alikes: other schemes and ports, suffix and prefix tricks, the opaque null origin, an unrelated site", async () => {
    useCorsOrigin(CORRECTED);
    for (const origin of [
      "http://www.getensemblis.com", // wrong scheme
      "https://www.getensemblis.com:8443", // wrong port
      "https://www.getensemblis.com.evil.test", // suffix
      "https://evilwww.getensemblis.com", // prefix
      "https://sub.getensemblis.com", // a subdomain that was never listed
      "https://ensemblis-app.vercel.app.evil.test",
      "null", // sandboxed iframes and file:// pages
      "https://example.com",
    ]) {
      const res = await preflight(origin);
      expect(res.headers["access-control-allow-origin"], origin).toBeUndefined();
      expect(res.headers["access-control-allow-credentials"], origin).toBeUndefined();
    }
  });

  it("never answers with a wildcard, even when CORS_ORIGIN asks for one", async () => {
    useCorsOrigin(`*,https://*.vercel.app,${WWW}`);
    expect(config.corsOrigins).toEqual([WWW]);
    const res = await preflight("https://anything.vercel.app");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect((await preflight(WWW)).headers["access-control-allow-origin"]).toBe(WWW);
  });
});
