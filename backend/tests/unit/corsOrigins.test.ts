// CORS_ORIGIN parsing (src/lib/corsOrigins.ts). The production incident: the value was
//   https://ensemblis-app.vercel.app,https//www.getensemblis.com        (second entry: the colon is missing)
// The malformed entry could never match a browser's Origin, nothing said so, and the site on www. could not log in.

import { afterEach, describe, expect, it, vi } from "vitest";
import { describeCorsIssues, parseCorsOrigins } from "../../src/lib/corsOrigins";

const VERCEL = "https://ensemblis-app.vercel.app";
const WWW = "https://www.getensemblis.com";
const APEX = "https://getensemblis.com";

describe("parseCorsOrigins", () => {
  it("the incident value: keeps the Vercel origin, ignores the malformed entry and says what it probably meant", () => {
    const r = parseCorsOrigins(`${VERCEL},https//www.getensemblis.com`);
    expect(r.origins).toEqual([VERCEL]);
    expect(r.issues).toEqual([
      expect.objectContaining({ entry: "https//www.getensemblis.com", accepted: false, suggestion: WWW, problem: expect.stringMatching(/not a valid origin/) }),
    ]);
    const lines = describeCorsIssues(r);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/"https\/\/www\.getensemblis\.com" is IGNORED/);
    expect(lines[0]).toContain(`Did you mean "${WWW}"?`);
  });

  it("the corrected value allows www, the bare domain and the Vercel origin — each exactly, nothing more", () => {
    const r = parseCorsOrigins(`${WWW},${APEX},${VERCEL}`);
    expect(r.origins).toEqual([WWW, APEX, VERCEL]);
    expect(r.issues).toEqual([]);
    expect(describeCorsIssues(r)).toEqual([]);
  });

  it("www and the bare domain are different origins: one never implies the other", () => {
    expect(parseCorsOrigins(WWW).origins).toEqual([WWW]);
    expect(parseCorsOrigins(APEX).origins).toEqual([APEX]);
  });

  it("normalises the way a browser writes an origin: trims, drops trailing slashes and default ports, lower-cases, de-duplicates", () => {
    const r = parseCorsOrigins("  HTTPS://WWW.GetEnsemblis.com/ , https://www.getensemblis.com:443, http://localhost:3000/,,  ");
    expect(r.origins).toEqual([WWW, "http://localhost:3000"]);
    expect(r.issues).toEqual([]);
  });

  it("accepts a quoted value pasted into a dashboard, and an entry with a path (the path is dropped, and reported)", () => {
    expect(parseCorsOrigins(`"${WWW}"`).origins).toEqual([WWW]);
    const r = parseCorsOrigins(`${WWW}/login?x=1`);
    expect(r.origins).toEqual([WWW]);
    expect(r.issues).toEqual([expect.objectContaining({ accepted: true, problem: expect.stringMatching(/has no path/) })]);
    expect(describeCorsIssues(r)[0]).toMatch(/was adjusted/);
  });

  it("reads `https:/host` and `https:host` the way browsers do (as https://host) and reports the adjustment", () => {
    for (const odd of ["https:/www.getensemblis.com", "https:www.getensemblis.com"]) {
      const r = parseCorsOrigins(odd);
      expect(r.origins, odd).toEqual([WWW]);
      expect(r.issues, odd).toEqual([expect.objectContaining({ accepted: true, problem: expect.stringMatching(/without "\/\/" after the scheme/) })]);
    }
  });

  it("refuses wildcards: the API answers with credentials", () => {
    for (const bad of ["*", "https://*.vercel.app", "https://*"]) {
      const r = parseCorsOrigins(`${WWW},${bad}`);
      expect(r.origins, bad).toEqual([WWW]);
      expect(r.issues[0].problem, bad).toMatch(/wildcards are not allowed/);
    }
  });

  it("refuses space-separated lists, other schemes, credentials in the URL and hostless entries", () => {
    expect(parseCorsOrigins(`${WWW} ${APEX}`)).toMatchObject({ origins: [], issues: [expect.objectContaining({ problem: expect.stringMatching(/separate origins with commas/) })] });
    for (const bad of ["ftp://files.example.com", "javascript:alert(1)", "file:///etc/passwd", "chrome-extension://abcdef"]) {
      expect(parseCorsOrigins(bad).origins, bad).toEqual([]);
    }
    expect(parseCorsOrigins("https://user:pw@example.com").issues[0].problem).toMatch(/user name or password/);
    expect(parseCorsOrigins("https://").origins).toEqual([]);
  });

  it("suggests the likely intent for common slips, and nothing when it is not obvious", () => {
    const suggestion = (entry: string) => parseCorsOrigins(entry).issues[0]?.suggestion;
    expect(suggestion("https//www.getensemblis.com")).toBe(WWW);
    expect(suggestion("HTTP//Example.com/")).toBe("http://Example.com");
    expect(suggestion("https//localhost:3000")).toBe("https://localhost:3000");
    expect(suggestion("www.getensemblis.com")).toBe(WWW);
    expect(suggestion("httpbin.org")).toBe("https://httpbin.org"); // not "http://bin.org"
    expect(suggestion("localhost:3000")).toBe("http://localhost:3000");
    expect(suggestion("not an origin")).toBeUndefined();
  });

  it("unset or blank means the local development default, with nothing to report", () => {
    expect(parseCorsOrigins(undefined)).toEqual({ origins: ["http://localhost:3000"], issues: [] });
    expect(parseCorsOrigins("   ")).toEqual({ origins: ["http://localhost:3000"], issues: [] });
  });

  it("set but with nothing usable: no origin is allowed (never the localhost default) and the log says so", () => {
    const r = parseCorsOrigins("https//www.getensemblis.com");
    expect(r.origins).toEqual([]);
    const lines = describeCorsIssues(r);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/no usable origin.*every website is blocked/);
  });

  it("keeps a hostile or huge entry bounded", () => {
    const r = parseCorsOrigins(`${"a".repeat(5000)}`);
    expect(r.issues[0].entry.length).toBeLessThanOrEqual(200);
  });
});

describe("config picks the parsed origins up", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the incident value leaves one allowed origin, APP_URL falling back to the first valid one, and a warning naming the bad entry", async () => {
    vi.resetModules();
    vi.stubEnv("CORS_ORIGIN", `${VERCEL},https//www.getensemblis.com`);
    vi.stubEnv("APP_URL", "");
    const c = await import("../../src/config");
    expect(c.config.corsOrigins).toEqual([VERCEL]);
    expect(c.config.appUrl).toBe(VERCEL);
    expect(c.corsConfigWarnings().join("\n")).toMatch(/https\/\/www\.getensemblis\.com.*IGNORED.*Did you mean "https:\/\/www\.getensemblis\.com"/s);
  });

  it("APP_URL still wins over the first CORS origin", async () => {
    vi.resetModules();
    vi.stubEnv("CORS_ORIGIN", `${VERCEL},${WWW}`);
    vi.stubEnv("APP_URL", `${WWW}/`);
    const c = await import("../../src/config");
    expect(c.config.appUrl).toBe(WWW);
    expect(c.corsConfigWarnings()).toEqual([]);
  });
});
