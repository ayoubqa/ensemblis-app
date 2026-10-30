import { describe, expect, it } from "vitest";
import { redactAddresses } from "../../src/email/send";

describe("email provider errors in logs", () => {
  it("keep the domain and the reason but never an address", () => {
    expect(redactAddresses("The getensemblis.com domain is not verified.")).toBe("The getensemblis.com domain is not verified.");
    expect(redactAddresses("Invalid `to` field: someone@example.com, other.person+x@mail.example.org")).toBe("Invalid `to` field: <address>, <address>");
    expect(redactAddresses('from "Ensemblis <hello@getensemblis.com>" rejected')).toBe('from "Ensemblis <<address>>" rejected');
  });
});
