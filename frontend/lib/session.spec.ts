import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal browser: localStorage + events. lib/api.ts only touches these.
const store = new Map<string, string>();
const events: string[] = [];
beforeEach(() => {
  store.clear();
  events.length = 0;
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", { dispatchEvent: (e: Event) => events.push(e.type) });
  vi.stubGlobal("CustomEvent", class extends Event {});
});
afterEach(() => vi.unstubAllGlobals());

const unauthorized = () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

describe("a 401 ends the session only when it is about the stored token", () => {
  it("drops the token that failed and signs out", async () => {
    const { api, getToken, setToken } = await import("./api");
    setToken("old");
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()));
    await expect(api.me()).rejects.toThrow();
    expect(getToken()).toBeNull();
    expect(events).toHaveLength(1);
  });

  it("keeps a newer token another tab stored while the request was in flight (password change)", async () => {
    const { api, getToken, setToken } = await import("./api");
    setToken("old");
    vi.stubGlobal("fetch", vi.fn(async () => {
      setToken("new");
      return unauthorized();
    }));
    await expect(api.me()).rejects.toThrow();
    expect(getToken()).toBe("new");
    expect(events).toHaveLength(0);
  });

  it("a wrong password on /login doesn't end a guest's trial session", async () => {
    const { api, getToken, setToken } = await import("./api");
    setToken("guest-token");
    vi.stubGlobal("fetch", vi.fn(async () => unauthorized()));
    await expect(api.login({ email: "a@example.com", password: "wrong" })).rejects.toThrow();
    expect(getToken()).toBe("guest-token");
    expect(events).toHaveLength(0);
  });
});
