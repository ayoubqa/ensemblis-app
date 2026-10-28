import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionProblem, OFFLINE_MESSAGE, refusedMessage, serverAnswers } from "./api";

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

  const failedFetch = () => Promise.reject(new TypeError("Failed to fetch")); // what a CORS block or a dead server looks like to the page

  async function loginWith(apiUrl: string | undefined, origin: string, fetchImpl: (url: string, init?: RequestInit) => Promise<unknown> = failedFetch) {
    if (apiUrl === undefined) vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    else vi.stubEnv("NEXT_PUBLIC_API_URL", apiUrl);
    vi.resetModules();
    vi.stubGlobal("window", { location: { origin }, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, dispatchEvent: () => true });
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { api, ApiError } = await import("./api");
    const err = await api.login({ email: "a@example.com", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    return { message: err.message as string, consoleError, fetchMock };
  }

  it("with a proper API address: the generic message, and the console names the origin to allow", async () => {
    const { message, consoleError } = await loginWith("https://ensemblis-api.onrender.com", "https://www.getensemblis.com");
    expect(message).toBe(OFFLINE_MESSAGE);
    const logged = String(consoleError.mock.calls[0][0]);
    expect(logged).toContain("POST https://ensemblis-api.onrender.com/api/auth/login");
    expect(logged).toContain("add https://www.getensemblis.com to CORS_ORIGIN");
  });

  it("when nothing answers (server down, offline): the connection message, after one probe", async () => {
    const { message, fetchMock } = await loginWith("https://ensemblis-api.onrender.com", "https://www.getensemblis.com");
    expect(message).toBe(OFFLINE_MESSAGE);
    expect(fetchMock).toHaveBeenCalledTimes(2); // the login, then the reachability probe
  });

  it("when the server answers a simple request but the login got no readable response (CORS): says the server is up and which address to allow — not 'check your connection'", async () => {
    const { message, fetchMock } = await loginWith("https://ensemblis-api.onrender.com", "https://www.getensemblis.com", (url, init) =>
      init?.mode === "no-cors" ? Promise.resolve({ type: "opaque" }) : failedFetch()
    );
    expect(message).toBe(refusedMessage("https://www.getensemblis.com"));
    expect(message).toMatch(/server is running but didn't accept the request from this site \(www\.getensemblis\.com\).*CORS_ORIGIN/);
    expect(message).not.toMatch(/connection/i);
    const [probeUrl, probeInit] = fetchMock.mock.calls[1];
    expect(probeUrl).toBe("https://ensemblis-api.onrender.com/health/live");
    expect(probeInit).toMatchObject({ mode: "no-cors", credentials: "omit" });
  });

  it("a trailing slash on NEXT_PUBLIC_API_URL does not produce //api/… requests", async () => {
    const { fetchMock } = await loginWith("https://ensemblis-api.onrender.com/", "https://www.getensemblis.com");
    expect(fetchMock.mock.calls[0][0]).toBe("https://ensemblis-api.onrender.com/api/auth/login");
  });

  it("an HTTP response of any status is never reported as a connection problem (no probe, the server's own message)", async () => {
    const { api, ApiError } = await (async () => {
      vi.stubEnv("NEXT_PUBLIC_API_URL", "https://ensemblis-api.onrender.com");
      vi.resetModules();
      vi.stubGlobal("window", { location: { origin: "https://www.getensemblis.com" }, localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined }, dispatchEvent: () => true });
      return import("./api");
    })();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Wrong email or password" }), { status: 401, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await api.login({ email: "a@example.com", password: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, message: "Wrong email or password" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("with no API address built in: says so, instead of blaming the connection", async () => {
    const { message } = await loginWith(undefined, "https://www.getensemblis.com");
    expect(message).toMatch(/server address was not set when the site was built/);
  });
});

describe("serverAnswers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is true when the server responds, even to a request whose response the page may not read (opaque)", async () => {
    const f = vi.fn().mockResolvedValue({ type: "opaque", status: 0 });
    await expect(serverAnswers("https://api.example.com", f as unknown as typeof fetch)).resolves.toBe(true);
    expect(f).toHaveBeenCalledWith("https://api.example.com/health/live", expect.objectContaining({ mode: "no-cors", cache: "no-store", credentials: "omit" }));
  });

  it("is false when nothing answers", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(serverAnswers("https://api.example.com", f as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("is false without asking when the browser says it is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    const f = vi.fn();
    await expect(serverAnswers("https://api.example.com", f as unknown as typeof fetch)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("gives up after the timeout instead of hanging the login form", async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const pending = serverAnswers("https://api.example.com", hang as unknown as typeof fetch, 5000);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(pending).resolves.toBe(false);
  });
});

describe("refusedMessage", () => {
  it("names the site's host and the setting to change", () => {
    expect(refusedMessage("https://www.getensemblis.com")).toContain("www.getensemblis.com");
    expect(refusedMessage("not a url")).toContain("not a url");
  });
});
