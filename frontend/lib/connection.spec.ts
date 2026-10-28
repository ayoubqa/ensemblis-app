import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionProblem, OFFLINE_MESSAGE } from "./api";

describe("connectionProblem", () => {
  const LIVE = "https://www.getensemblis.com";

  it("recognises a site built without its API address (it falls back to localhost)", () => {
    expect(connectionProblem("http://localhost:4000", LIVE)).toMatch(/not set when the site was built.*NEXT_PUBLIC_API_URL/);
    expect(connectionProblem("http://127.0.0.1:4000", LIVE)).toMatch(/points at localhost/);
  });

  it("recognises an http:// API address on an https:// page (browsers block it)", () => {
    expect(connectionProblem("http://ensemblis-api.onrender.com", LIVE)).toMatch(/insecure \(http:\/\/\).*https:\/\//);
  });

  it("recognises an API address that isn't a web address", () => {
    expect(connectionProblem("ensemblis-api.onrender.com", LIVE)).toMatch(/isn't a valid web address/);
  });

  it("says nothing it can't know: a proper https address, local development, or no page", () => {
    expect(connectionProblem("https://ensemblis-api.onrender.com", LIVE)).toBeNull(); // CORS, offline or a down server look the same from here
    expect(connectionProblem("http://localhost:4000", "http://localhost:3000")).toBeNull();
    expect(connectionProblem("http://localhost:4000", null)).toBeNull();
  });
});

describe("a failed fetch (login, sign-up, every request)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loginWith(apiUrl: string | undefined, origin: string) {
    if (apiUrl === undefined) vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    else vi.stubEnv("NEXT_PUBLIC_API_URL", apiUrl);
    vi.resetModules();
    vi.stubGlobal("window", { location: { origin }, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, dispatchEvent: () => true });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))); // what a CORS block looks like to the page
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { api, ApiError } = await import("./api");
    const err = await api.login({ email: "a@example.com", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    return { message: err.message as string, consoleError };
  }

  it("with a proper API address: the generic message, and the console names the origin to allow", async () => {
    const { message, consoleError } = await loginWith("https://ensemblis-api.onrender.com", "https://www.getensemblis.com");
    expect(message).toBe(OFFLINE_MESSAGE);
    const logged = String(consoleError.mock.calls[0][0]);
    expect(logged).toContain("POST https://ensemblis-api.onrender.com/api/auth/login");
    expect(logged).toContain("add https://www.getensemblis.com to CORS_ORIGIN");
  });

  it("with no API address built in: says so, instead of blaming the connection", async () => {
    const { message } = await loginWith(undefined, "https://www.getensemblis.com");
    expect(message).toMatch(/server address was not set when the site was built/);
  });
});
