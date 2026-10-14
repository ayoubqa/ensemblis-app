import { describe, expect, it } from "vitest";
import { ROUTES, loginUrl, safeNext, signupUrl } from "./routes";

describe("safeNext", () => {
  it("allows same-site relative paths", () => {
    expect(safeNext("/objectives/abc")).toBe("/objectives/abc");
  });
  it.each(["https://evil.com", "//evil.com", "/\\evil.com", "/\t/evil.com", "javascript:alert(1)", ""])("rejects %j", (bad) => {
    expect(safeNext(bad, "/fallback")).toBe("/fallback");
  });
});

describe("auth URLs", () => {
  it("carry ?next= when given", () => {
    expect(loginUrl("/objectives/x")).toBe("/login?next=%2Fobjectives%2Fx");
    expect(signupUrl(null)).toBe("/signup");
    expect(loginUrl("/")).toBe("/login");
  });
  it("objective routes encode ids", () => {
    expect(ROUTES.objective("a/b")).toBe("/objectives/a%2Fb");
  });
});
