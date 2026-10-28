// CORS is an exact-match allow-list. A site served from an origin that isn't on it gets no
// Access-Control-Allow-Origin header, the browser refuses the response, and the page only sees a failed
// fetch ("Can't reach the Ensemblis server") while /health stays green. These tests pin that behaviour
// and the log line that makes it visible on the server.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/config";
import { log } from "../../src/lib/log";
import { resetRejectedOriginsForTests } from "../../src/lib/cors";
import { api } from "../helpers";

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
