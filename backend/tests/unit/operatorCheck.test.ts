import { describe, expect, it } from "vitest";
import { isAdminEmail, parseAdminEmails } from "../../src/config";
import { findYourEntry, operatorCheck } from "../../src/admin/operatorCheck";

const ME = "admin@getensemblis.com";
const check = (raw: string | undefined, envKeys: string[] = []) => operatorCheck(raw, parseAdminEmails(raw), ME, envKeys);

describe("ADMIN_EMAILS parsing (the live rule)", () => {
  it("splits on commas, trims and lower-cases", () => {
    expect(parseAdminEmails(" Admin@GetEnsemblis.com ,b@x.io,, ")).toEqual(["admin@getensemblis.com", "b@x.io"]);
    expect(parseAdminEmails("admin@getensemblis.com\n\t")).toEqual([ME]);
    expect(parseAdminEmails(" admin@getensemblis.com﻿")).toEqual([ME]);
  });
  it("is empty when unset or blank", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails("  , ")).toEqual([]);
  });
  it("does not strip quotes, invisible characters or a pasted key (they make the entry not match)", () => {
    for (const raw of ['"admin@getensemblis.com"', "admin@getensemblis.com​", "ADMIN_EMAILS=admin@getensemblis.com", "аdmin@getensemblis.com"]) {
      expect(parseAdminEmails(raw)).not.toContain(ME);
    }
  });
});

describe("operator check: only the caller's own entry", () => {
  it("an exact match", () => {
    expect(check(ME)).toEqual({
      adminEmailsDefined: true,
      hasEntries: true,
      yourEmailMatches: true,
      yourEntry: { issues: [], unusualCharacters: [] },
      closeMatch: false,
      differsFromBootValue: false,
      nearMissKeys: [],
    });
  });

  it("unset, and blank", () => {
    expect(check(undefined)).toMatchObject({ adminEmailsDefined: false, hasEntries: false, yourEmailMatches: false, yourEntry: null, closeMatch: false });
    expect(check(" , ")).toMatchObject({ adminEmailsDefined: true, hasEntries: false, yourEntry: null });
  });

  it.each([
    ['"admin@getensemblis.com"', ["quotes"], []],
    ["“admin@getensemblis.com”", ["quotes"], ["U+201C", "U+201D"]],
    ["admin@getensemblis.com​", ["invisible_characters"], ["U+200B"]],
    ["admin@get‍ensemblis.com", ["invisible_characters"], ["U+200D"]],
    ["аdmin@getensemblis.com", ["look_alike_characters"], ["U+0430"]],
    ["admin@gеtеnsemblis.com", ["look_alike_characters"], ["U+0435"]],
    ["ADMIN_EMAILS=admin@getensemblis.com", ["pasted_prefix"], []],
    ["mailto:admin@getensemblis.com", ["pasted_prefix"], []],
    ["<admin@getensemblis.com>", ["angle_brackets"], []],
    ["other@x.io; admin@getensemblis.com", ["wrong_separator"], []],
  ])("finds your entry in %j and says what's wrong", (raw, issues, unusual) => {
    const r = check(raw);
    expect(r.yourEmailMatches).toBe(false);
    expect(r.yourEntry).toEqual({ issues, unusualCharacters: unusual });
    expect(r.closeMatch).toBe(false);
  });

  it("several problems at once", () => {
    expect(check('"ADMIN_EMAILS=аdmin@getensemblis.com​"').yourEntry).toEqual({
      issues: ["quotes", "invisible_characters", "look_alike_characters", "pasted_prefix"],
      unusualCharacters: ["U+0430", "U+200B"],
    });
  });

  describe("formatting is never mistaken for look-alike letters", () => {
    // Every combination of the formatting a paste can add around the plain ASCII address.
    const quotes: [string, string][] = [["", ""], ['"', '"'], ["'", "'"], ["“", "”"]];
    const prefixes = ["", "mailto:", "MAILTO:", "mailto: ", "ADMIN_EMAILS=", "ADMIN_EMAILS = ", "admin_emails=", "ADMIN_EMAIL="];
    const brackets: [string, string][] = [["", ""], ["<", ">"], ["< ", " >"]];
    const combos: { raw: string; expected: string[] }[] = [];
    for (const [qo, qc] of quotes)
      for (const p of prefixes)
        for (const [bo, bc] of brackets) {
          // Prefix outside the brackets, and inside them ("<mailto:…>").
          for (const inner of [false, true]) {
            const body = inner ? `${bo}${p}${ME}${bc}` : `${p}${bo}${ME}${bc}`;
            const expected = [qo ? "quotes" : "", p ? "pasted_prefix" : "", bo ? "angle_brackets" : ""].filter(Boolean);
            combos.push({ raw: `${qo}${body}${qc}`, expected });
          }
        }

    it(`all ${combos.length} combinations: found, exact issues, never look_alike_characters`, () => {
      for (const { raw, expected } of combos) {
        const r = check(raw);
        expect(r.yourEntry, raw).not.toBeNull();
        expect(r.yourEntry!.issues, raw).toEqual(expected);
        expect(r.yourEntry!.issues, raw).not.toContain("look_alike_characters");
        expect(r.yourEntry!.issues, raw).not.toContain("wrong_separator");
      }
    });

    it.each([
      ["mailto: admin@getensemblis.com", ["pasted_prefix"]],
      ["< admin@getensemblis.com >", ["angle_brackets"]],
      ["<mailto:admin@getensemblis.com>", ["pasted_prefix", "angle_brackets"]],
      ["ADMIN_EMAILS=<admin@getensemblis.com>", ["pasted_prefix", "angle_brackets"]],
      ['<"admin@getensemblis.com">', ["quotes", "angle_brackets"]],
    ])("regression: %j → %j (was misread as a separator, or not found)", (raw, issues) => {
      expect(check(raw).yourEntry).toEqual({ issues, unusualCharacters: raw.includes("“") ? ["U+201C", "U+201D"] : [] });
    });
  });

  describe("formatting combined with genuine look-alike letters", () => {
    it.each([
      ["mailto:аdmin@getensemblis.com", ["look_alike_characters", "pasted_prefix"], ["U+0430"]],
      ["mailto: аdmin@getensemblis.com", ["look_alike_characters", "pasted_prefix"], ["U+0430"]],
      ["ADMIN_EMAILS=аdmin@getensemblis.com", ["look_alike_characters", "pasted_prefix"], ["U+0430"]],
      ["<аdmin@getensemblis.com>", ["look_alike_characters", "angle_brackets"], ["U+0430"]],
      ["<mailto:admin@gеtensemblis.com>", ["look_alike_characters", "pasted_prefix", "angle_brackets"], ["U+0435"]],
      ['"аdmin@getensemblis.com"', ["quotes", "look_alike_characters"], ["U+0430"]],
      ["“mailto:аdmin@getensemblis.com”", ["quotes", "look_alike_characters", "pasted_prefix"], ["U+201C", "U+0430", "U+201D"]],
      ['"ADMIN_EMAILS=<аdmin@gеtensemblis.com>"', ["quotes", "look_alike_characters", "pasted_prefix", "angle_brackets"], ["U+0430", "U+0435"]],
      ["<аdmin@getensemblis.com​>", ["invisible_characters", "look_alike_characters", "angle_brackets"], ["U+0430", "U+200B"]],
      ["x@y.io; mailto:аdmin@getensemblis.com", ["look_alike_characters", "pasted_prefix", "wrong_separator"], ["U+0430"]],
      ["ａdmin@getensemblis.com", ["look_alike_characters"], ["U+FF41"]], // fullwidth "a" (NFKC)
    ])("%j → %j", (raw, issues, unusual) => {
      const r = check(raw);
      expect(r.yourEmailMatches).toBe(false); // the live rule stays exact
      expect(r.yourEntry).toEqual({ issues, unusualCharacters: unusual });
    });
  });

  it("formatting with nothing inside is not your entry", () => {
    for (const raw of ["mailto:", "<>", "ADMIN_EMAILS=", '""', "<mailto:>"]) expect(check(raw).yourEntry, raw).toBeNull();
  });

  it("a typo is reported only as a yes/no close match, never as an entry", () => {
    const r = check("admin@getensemblis.co");
    expect(r).toMatchObject({ yourEmailMatches: false, yourEntry: null, closeMatch: true });
    expect(check("someone.else@other-company.io")).toMatchObject({ yourEntry: null, closeMatch: false });
  });

  it("never describes another operator's entry, and never returns a list, mask or count", () => {
    const raw = '"other.operator@private.example", аlice@private.example, admin@getensemblis.com​';
    const r = check(raw);
    expect(r.yourEntry).toEqual({ issues: ["invisible_characters"], unusualCharacters: ["U+200B"] }); // only mine
    expect(Object.keys(r).sort()).toEqual(["adminEmailsDefined", "closeMatch", "differsFromBootValue", "hasEntries", "nearMissKeys", "yourEmailMatches", "yourEntry"]);
    const json = JSON.stringify(r);
    for (const leak of ["other", "operator", "private", "alice", "lice", "U+0430", "***", "getensemblis", "admin@"]) expect(json).not.toContain(leak);
  });

  it("another operator's problems stay invisible when you are listed correctly", () => {
    const r = check('"broken@x.io", admin@getensemblis.com');
    expect(r.yourEntry).toEqual({ issues: [], unusualCharacters: [] });
    expect(JSON.stringify(r)).not.toContain("quotes");
  });

  it("someone whose address merely contains yours is not 'your entry'", () => {
    expect(findYourEntry(["superadmin@getensemblis.com", "admin@getensemblis.com.evil.io"], ME)).toBeNull();
  });

  it("recognising look-alikes never changes the live rule", () => {
    // findYourEntry recognises the entry for the report; isAdminEmail (authorisation) stays exact.
    expect(findYourEntry(["аdmin@getensemblis.com"], ME)).not.toBeNull();
    expect(parseAdminEmails("аdmin@getensemblis.com")).not.toContain(ME);
    expect(isAdminEmail("аdmin@getensemblis.com")).toBe(false);
  });

  it("reports a value that changed since boot (the process authorises with the boot value)", () => {
    expect(operatorCheck(ME, [], ME, [])).toMatchObject({ yourEmailMatches: false, differsFromBootValue: true, yourEntry: { issues: [] } });
  });

  it("lists only misspellings of ADMIN_EMAILS by name, escaped so stray spaces show", () => {
    const keys = ["ADMIN_EMAIL", "ADMIN_EMAILS ", "admin_emails", "ADMIN-EMAILS", "ADMIN_EMAILS", "DATABASE_URL", "ADMIN_TOKEN", "STRIPE_ADMIN_KEY", "SUPERADMIN_EMAILS"];
    expect(check(undefined, keys).nearMissKeys).toEqual(['"ADMIN-EMAILS"', '"ADMIN_EMAIL"', '"ADMIN_EMAILS "', '"admin_emails"']);
  });
});
