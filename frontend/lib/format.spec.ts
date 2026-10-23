import { describe, expect, it } from "vitest";
import { credits, creditsNum, creditsSigned, eur } from "./format";

describe("credits formatting", () => {
  it("shows whole credits with a unit", () => {
    expect(credits(1150)).toBe("1,150 credits");
    expect(credits(1)).toBe("1 credit");
    expect(credits(0)).toBe("0 credits");
    expect(credits(null)).toBe("0 credits");
    expect(credits(-250)).toBe("−250 credits");
  });

  it("signs ledger amounts", () => {
    expect(creditsSigned(3000)).toBe("+3,000 credits");
    expect(creditsSigned(-1150)).toBe("−1,150 credits");
    expect(creditsSigned(0)).toBe("0 credits");
  });

  it("can show just the number", () => {
    expect(creditsNum(50000)).toBe("50,000");
  });

  it("keeps euros for real money only (credit pack prices)", () => {
    expect(eur(1000)).toBe("€10");
    expect(eur(2550)).toBe("€25.50");
  });
});
