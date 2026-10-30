import { describe, expect, it } from "vitest";
import { parseAdminEmails } from "../../src/config";
import { describeEntry, maskEmail, operatorCheck } from "../../src/admin/operatorCheck";

const ME = "admin@getensemblis.com";

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

describe("operator check", () => {
  it("masks entries so they are recognisable but not readable", () => {
    expect(maskEmail(ME)).toBe("a***n@g***s.com");
    expect(maskEmail("jo@ex.co.uk")).toBe("**@**.co.uk");
    expect(maskEmail("no-at-sign")).toBe("n***n");
  });

  it("a clean match", () => {
    const r = operatorCheck(ME, [ME], ME, ["ADMIN_EMAILS", "PATH"]);
    expect(r).toMatchObject({ adminEmailsDefined: true, entryCount: 1, yourEmailMatches: true, yourEmailMatchesAfterCleanup: true, differsFromBootValue: false, similarKeys: [] });
    expect(r.entries).toEqual([{ masked: "a***n@g***s.com", length: 22, looksLikeEmail: true, hasQuotes: false, unusualCharacters: [] }]);
  });

  it("unset", () => {
    expect(operatorCheck(undefined, [], ME, [])).toMatchObject({ adminEmailsDefined: false, entryCount: 0, yourEmailMatches: false });
  });

  it("flags a zero-width character and says cleanup would match", () => {
    const raw = "admin@getensemblis.com​";
    const r = operatorCheck(raw, parseAdminEmails(raw), ME, []);
    expect(r.yourEmailMatches).toBe(false);
    expect(r.yourEmailMatchesAfterCleanup).toBe(true);
    expect(r.entries[0]).toMatchObject({ looksLikeEmail: false, unusualCharacters: ["U+200B"] });
  });

  it("flags quotes", () => {
    const raw = '"admin@getensemblis.com"';
    const r = operatorCheck(raw, parseAdminEmails(raw), ME, []);
    expect(r).toMatchObject({ yourEmailMatches: false, yourEmailMatchesAfterCleanup: true });
    expect(r.entries[0].hasQuotes).toBe(true);
  });

  it("flags a look-alike letter, which cleanup does not (and must not) fix", () => {
    const raw = "аdmin@getensemblis.com";
    const r = operatorCheck(raw, parseAdminEmails(raw), ME, []);
    expect(r).toMatchObject({ yourEmailMatches: false, yourEmailMatchesAfterCleanup: false });
    expect(r.entries[0].unusualCharacters).toEqual(["U+0430"]);
  });

  it("reports a value that changed since boot (the process authorises with the boot value)", () => {
    const r = operatorCheck(ME, [], ME, []);
    expect(r).toMatchObject({ yourEmailMatches: false, differsFromBootValue: true });
  });

  it("lists similar key NAMES only, escaped so stray spaces show", () => {
    const r = operatorCheck(undefined, [], ME, ["ADMIN_EMAIL", "ADMIN_EMAILS ", "admin_emails", "ADMIN_EMAILS", "DATABASE_URL"]);
    expect(r.similarKeys).toEqual(['"ADMIN_EMAIL"', '"ADMIN_EMAILS "', '"admin_emails"']);
  });

  it("never returns the raw value anywhere", () => {
    const raw = "secret.person@private-domain.example, admin@getensemblis.com";
    const json = JSON.stringify(operatorCheck(raw, parseAdminEmails(raw), ME, ["ADMIN_EMAILS"]));
    expect(json).not.toContain("secret.person");
    expect(json).not.toContain("private-domain");
    expect(json).not.toContain(ME);
  });

  it("describes an entry's characters by code point only", () => {
    expect(describeEntry("a b@c.d").unusualCharacters).toEqual(["U+00A0"]);
  });
});
