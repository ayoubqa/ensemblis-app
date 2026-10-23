// The domains a result may link to (engine/serialize.ts linkDomainsOf) are what the executor's link
// cleaner allows: the evidence plus any domain named in the objective, the owner's notes or the
// company website — the website stamped when the execution was planned. The report renderers link
// nothing else. The owner's console gets them all; the public shared report only the evidence domains
// and the hosts the result itself links to — never the notes', nor anything else in the statement.
import { describe, expect, it } from "vitest";
import { prisma } from "../../src/db";
import { allowedLinkDomains } from "../../src/research/citations";
import { linkDomainsOf } from "../../src/engine/serialize";
import { loadPublicReport } from "../../src/public/routes";
import { api, createUser, fillContext, getExecution, runWorker } from "../helpers";

const STATEMENT = "Size the market for the product on acme.example and compare it with https://rival.example.com/pricing.";
const NOTES = "Board deck: https://private-notes.example/q3 (also see secret-partner.example).";
const WEBSITE = "https://www.company.example/";
const EVIDENCE = [
  { domain: "research.example.org", url: "https://research.example.org/a" },
  { domain: null, url: "https://www.stats.example.net/t" },
  { domain: null, url: null },
];
/** A cleaned result: links on allowed domains (one the notes', one a subdomain of the statement's), a plain-text domain. */
const RESULT =
  "# Brief\n\nPrices: [rival](https://rival.example.com/pricing), <https://www.company.example/about>, [deck](https://private-notes.example/q3) " +
  "and https://shop.acme.example/x [1]. Also see acme.example and evil.example.";
const PUBLIC = ["company.example", "research.example.org", "rival.example.com", "shop.acme.example", "stats.example.net"];

const sorted = (xs: readonly string[] | null | undefined) => [...(xs ?? [])].sort();

describe("linkDomainsOf", () => {
  const row = { evidence: EVIDENCE, objective: { statement: STATEMENT, contextNotes: NOTES }, organization: { context: { website: WEBSITE } }, result: RESULT };

  it("owner: exactly the executor's allowlist (evidence, objective, notes, website)", () => {
    const owner = linkDomainsOf(row);
    expect(owner).toEqual(allowedLinkDomains(`${STATEMENT} ${NOTES} ${WEBSITE}`, EVIDENCE));
    expect(sorted(owner)).toEqual(
      ["acme.example", "company.example", "private-notes.example", "research.example.org", "rival.example.com", "secret-partner.example", "stats.example.net"].sort()
    );
  });

  it("public view: the evidence domains and the hosts the result links to that the objective or website allowed — never a notes' domain", () => {
    const pub = linkDomainsOf(row, { publicView: true });
    expect(sorted(pub)).toEqual(PUBLIC);
    expect(pub.join(" ")).not.toMatch(/private-notes|secret-partner|evil/);
    // A domain the statement names but the result doesn't link to stays private.
    expect(pub).not.toContain("acme.example");
    // Emphasis or a full stop around a URL is not part of its host.
    expect(sorted(linkDomainsOf({ ...row, result: "Shop: **https://Shop.ACME.example**, or _www.company.example_." }, { publicView: true }))).toEqual(
      ["company.example", "research.example.org", "shop.acme.example", "stats.example.net"]
    );
    expect(sorted(linkDomainsOf({ ...row, result: "# Brief" }, { publicView: true }))).toEqual(["research.example.org", "stats.example.net"]);
    expect(sorted(linkDomainsOf({ ...row, result: null }, { publicView: true }))).toEqual(["research.example.org", "stats.example.net"]);
  });

  it("public view: no token of a private statement leaks (e-mail address parts, file-like names, a bare public suffix)", () => {
    const statement =
      "Prepare the board memo on acquiring Falcon (contact: jane.doe@falcon-target-co.com, data room at dataroom.falcon-target-co.com). " +
      "Compare UK .co.uk retailers. Use Q3.final numbers.";
    const ex = {
      evidence: [{ domain: "research.example.org", url: "https://research.example.org/a" }],
      objective: { statement, contextNotes: "Our lawyer is at secret-counsel-llp.com" },
      organization: { context: { website: "https://acme.example" } },
      result: "# Memo\n\nThe figures come from [the data room](https://dataroom.falcon-target-co.com/index) [1]. Ask jane.doe@falcon-target-co.com; use the Q3.final numbers.",
    };
    // The owner's console keeps the executor's allowlist, unchanged.
    expect(linkDomainsOf(ex)).toEqual(allowedLinkDomains(`${statement} ${ex.objective.contextNotes} https://acme.example`, ex.evidence));
    const pub = linkDomainsOf(ex, { publicView: true });
    expect(sorted(pub)).toEqual(["dataroom.falcon-target-co.com", "research.example.org"]);
    expect(pub.join(" ")).not.toMatch(/jane|doe|q3|final|co\.uk|secret-counsel|acme/);
    expect(pub).not.toContain("falcon-target-co.com");
    expect(linkDomainsOf({ ...ex, result: "# Memo" }, { publicView: true })).toEqual(["research.example.org"]);
  });

  it("uses the website stamped when the execution was planned; the current one only for plans from before that stamp", () => {
    const current = { context: { website: "https://new-site.example" } };
    const base = { evidence: [], objective: { statement: "Brief", contextNotes: "" }, organization: current, result: "See https://old-site.example/a and https://new-site.example/b." };
    const plan = (runtime: object) => ({ title: "Plan", steps: [], runtime: { modelEndpoint: null, searchEndpoint: null, ...runtime } });

    const stamped = { ...base, plan: plan({ website: "https://www.old-site.example/" }) };
    expect(linkDomainsOf(stamped)).toEqual(["old-site.example"]);
    expect(linkDomainsOf(stamped, { publicView: true })).toEqual(["old-site.example"]);
    // The run had no website: a website added later doesn't become allowed.
    expect(linkDomainsOf({ ...base, plan: plan({ website: "" }) })).toEqual([]);
    // Older plans: no runtime, or a runtime without the website.
    for (const old of [undefined, { title: "Plan", steps: [] }, plan({})]) {
      expect(linkDomainsOf({ ...base, plan: old })).toEqual(["new-site.example"]);
      expect(linkDomainsOf({ ...base, plan: old }, { publicView: true })).toEqual(["new-site.example"]);
    }
  });

  it("works without an objective, an organization or a company context row", () => {
    expect(linkDomainsOf({ evidence: EVIDENCE })).toEqual(["research.example.org", "stats.example.net"]);
    expect(linkDomainsOf({ evidence: EVIDENCE }, { publicView: true })).toEqual(["research.example.org", "stats.example.net"]);
    expect(linkDomainsOf({ evidence: [], objective: null, organization: { context: null } })).toEqual([]);
  });
});

describe("linkDomains in the API", () => {
  it("the owner's execution carries the notes' domains; the shared report only the evidence's and the hosts the result links to", async () => {
    const { user, auth } = await createUser();
    const org = await prisma.organization.create({ data: { ownerId: user.id, name: "Org" } });
    await prisma.companyContext.create({ data: { orgId: org.id, website: WEBSITE } });
    const objective = await prisma.objective.create({ data: { orgId: org.id, title: "Market size", statement: STATEMENT, contextNotes: NOTES, budgetCents: 1000 } });
    const ex = await prisma.execution.create({
      data: { orgId: org.id, objectiveId: objective.id, status: "COMPLETED", result: RESULT, shareToken: "share_token_linkdomains_0001", completedAt: new Date() },
    });
    await prisma.evidence.createMany({
      data: EVIDENCE.map((e, i) => ({ orgId: org.id, executionId: ex.id, n: i + 1, kind: e.url ? ("WEB" as const) : ("COMPANY_CONTEXT" as const), title: `S${i + 1}`, url: e.url, domain: e.domain, excerpt: "x", content: "x" })),
    });

    const owner = (await api().get(`/api/executions/${ex.id}`).set(auth).expect(200)).body.execution.linkDomains as string[];
    expect(owner).toEqual(expect.arrayContaining(["private-notes.example", "secret-partner.example", "company.example", "acme.example", "research.example.org"]));
    // The objective detail serves the same full execution.
    const detail = (await api().get(`/api/objectives/${objective.id}`).set(auth).expect(200)).body.execution.linkDomains as string[];
    expect(sorted(detail)).toEqual(sorted(owner));

    const report = await loadPublicReport("share_token_linkdomains_0001");
    expect(report?.kind).toBe("execution");
    expect(sorted(report && "linkDomains" in report ? report.linkDomains : null)).toEqual(PUBLIC);
    const body = (await api().get("/api/public/reports/share_token_linkdomains_0001").expect(200)).body.report;
    expect(sorted(body.linkDomains)).toEqual(PUBLIC);
    expect(JSON.stringify(body.linkDomains)).not.toMatch(/private-notes|secret-partner|"acme\.example"/);
  });

  it("planning stamps the company website: changing it later in Company Context doesn't change an earlier result's links", async () => {
    const { user, auth } = await createUser({ credits: 5000 });
    await fillContext(auth);
    const org = await prisma.organization.findFirstOrThrow({ where: { ownerId: user.id } });
    await prisma.companyContext.update({ where: { orgId: org.id }, data: { website: "https://www.old-site.example/" } });
    const res = await api()
      .post("/api/objectives")
      .set(auth)
      .send({ statement: "Analyze the European market for our liquid-cooling product and recommend three markets.", successCriteria: [{ description: "Recommend 3 markets" }], budgetCents: 3000, autonomy: "AUTO_WITHIN_BUDGET" })
      .expect(201);
    await runWorker();
    const executionId = res.body.executionId as string;
    const row = await prisma.execution.findUniqueOrThrow({ where: { id: executionId } });
    expect(row.status).toBe("COMPLETED");
    expect((row.plan as { runtime?: { website?: string } }).runtime?.website).toBe("https://www.old-site.example/");
    expect((await getExecution(auth, executionId)).linkDomains).toContain("old-site.example");

    await prisma.companyContext.update({ where: { orgId: org.id }, data: { website: "https://new-site.example" } });
    const after = (await getExecution(auth, executionId)).linkDomains as string[];
    expect(after).toContain("old-site.example");
    expect(after).not.toContain("new-site.example");
  });
});
