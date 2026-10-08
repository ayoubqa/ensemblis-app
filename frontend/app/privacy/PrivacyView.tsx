"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import type { ReactNode } from "react";
import { AiProvider, Contact, LegalPage, Sec, type LegalSection } from "../_legal/LegalBits";

const SECTIONS: LegalSection[] = [
  { id: "who", title: "Who is responsible" },
  { id: "what", title: "What we collect and why" },
  { id: "browser", title: "What's stored in your browser" },
  { id: "sharing", title: "Who receives your data" },
  { id: "retention", title: "How long we keep it" },
  { id: "rights", title: "Your rights" },
  { id: "security", title: "Security" },
  { id: "age", title: "Age" },
  { id: "changes", title: "Changes to this policy" },
];

/** One row of the "what we collect" table (stacks into a labelled record on phones). */
function DataRow({ data, why, basis }: { data: ReactNode; why: ReactNode; basis: ReactNode }) {
  return (
    <tr>
      <td data-label="Data">{data}</td>
      <td data-label="Why">{why}</td>
      <td data-label="Legal basis (GDPR)">{basis}</td>
    </tr>
  );
}

export function PrivacyView() {
  return (
    <LegalPage
      title="Privacy Policy"
      other="terms"
      sections={SECTIONS}
      intro="Ensemblis is a free public demo of an AI operating layer for business, operated by an individual based in Spain. This page explains, in plain language, what personal data it handles and what you can do about it."
      summary={[
        "We collect only what's needed to operate the demo: your account details, the objectives, Company Context and documents you provide, the AI results, and your usage history.",
        <>
          The text of your objectives — with the relevant Company Context, document passages and memory — is sent to our AI provider (<AiProvider />) to generate results.
        </>,
        "No advertising, no ad trackers, no selling of data. Your browser stores a login token so you stay signed in.",
        <>
          You can ask for a copy of your data or for it to be deleted at any time by writing to <Contact />.
        </>,
      ]}
    >
      <Sec id="who">
        <p>
          The data controller is the individual who operates this Ensemblis demo, based in Spain (European Union). Ensemblis is a personal project, not a
          registered company. You can reach the operator at <Contact />.
        </p>
      </Sec>

      <Sec id="what">
        <div className="au-dtable-wrap">
          <table className="au-dtable">
            <caption>Personal data we process, why, and the legal basis</caption>
            <thead>
              <tr>
                <th scope="col">Data</th>
                <th scope="col">Why</th>
                <th scope="col">Legal basis (GDPR)</th>
              </tr>
            </thead>
            <tbody>
              <DataRow
                data={
                  <>
                    <b>Account details</b> — name, email, and optionally company and role
                  </>
                }
                why="To create your account, sign you in and show your profile"
                basis="Performing our agreement with you (Art. 6(1)(b))"
              />
              <DataRow
                data={
                  <>
                    <b>Password</b> — stored only as a one-way hash, never in readable form
                  </>
                }
                why="To secure your account"
                basis="Art. 6(1)(b)"
              />
              <DataRow
                data={
                  <>
                    <b>Objective content</b> — objectives, success criteria, plans, AI-generated outputs, evidence, verification results, and recurring objectives you set up
                  </>
                }
                why="To execute your objectives and show you the results"
                basis="Art. 6(1)(b)"
              />
              <DataRow
                data={
                  <>
                    <b>Usage records</b> — which executions took place, when, their cost, top-ups and refunds
                  </>
                }
                why="To operate your usage balance, apply fair-use limits and prevent abuse"
                basis="Art. 6(1)(b) and our legitimate interest in keeping the service working (Art. 6(1)(f))"
              />
              <DataRow
                data={
                  <>
                    <b>Company Context and memory</b> — the business profile, documents and website you provide, and learnings you confirm
                  </>
                }
                why="To ground your objectives in your business. Documents are treated as data, never as instructions to the AI."
                basis="Art. 6(1)(b)"
              />
              <DataRow
                data={
                  <>
                    <b>Technical logs</b> — IP address, browser type and request times, recorded by the hosting infrastructure
                  </>
                }
                why="Security, debugging and preventing abuse"
                basis="Legitimate interest (Art. 6(1)(f))"
              />
            </tbody>
          </table>
        </div>
        <p>
          We don&apos;t ask for, and you shouldn&apos;t submit, sensitive data (health, religion, political views, etc.) or other people&apos;s personal data. See
          the <Link href={ROUTES.terms}>Terms</Link>.
        </p>
      </Sec>

      <Sec id="browser">
        <p>We don&apos;t use advertising or analytics trackers. The site stores only what it needs to work:</p>
        <ul>
          <li>
            <b>A login token</b> in your browser&apos;s local storage, so you stay signed in. Logging out removes it.
          </li>
          <li>Small preferences such as your light/dark theme choice, which notifications you&apos;ve read, and whether you closed the demo banner.</li>
        </ul>
        <p>These are strictly necessary for the service you asked for, so they don&apos;t require a consent banner.</p>
      </Sec>

      <Sec id="sharing">
        <p>We never sell your data or use it for advertising. To operate the demo we rely on a few service providers who process data on our behalf:</p>
        <ul>
          <li>
            <b>Hosting provider</b> — serves the website and the application server.
          </li>
          <li>
            <b>Database provider</b> — stores accounts, objectives, Company Context, memory, results and usage records.
          </li>
          <li>
            <b>AI provider: <AiProvider /></b> — when an objective is executed, its description, relevant context and the intermediate steps are sent to this provider so its models
            can generate the result. The provider processes that text under its own API terms.
          </li>
        </ul>
        <p>
          Some of these providers may process data outside the European Economic Area (for example in the United States). When that happens, the transfer
          relies on the safeguards the provider offers, such as the EU Commission&apos;s Standard Contractual Clauses or the EU–US Data Privacy Framework.
          You can ask us which providers are used at any time.
        </p>
        <p>We may also disclose data if the law requires it.</p>
      </Sec>

      <Sec id="retention">
        <ul>
          <li>Account data, objectives, Company Context, memory and results are kept while your account exists. You can edit or delete documents and memory items at any time.</li>
          <li>
            You can ask for your account and everything in it to be deleted at any time. We&apos;ll do it within 30 days; residual copies in backups expire
            on their normal cycle.
          </li>
          <li>Because this is a demo, data may be reset or deleted at any time, and everything is deleted if the demo is shut down.</li>
          <li>Technical logs are kept only briefly by the hosting infrastructure, as part of its normal operation.</li>
        </ul>
      </Sec>

      <Sec id="rights">
        <p>Under the GDPR and Spain&apos;s data-protection law (LOPDGDD) you can ask to:</p>
        <ul>
          <li>
            <b>Access</b> your data and get a copy of it (including in a portable format).
          </li>
          <li>
            <b>Rectify</b> inaccurate data — you can also edit your profile yourself in <Link href={ROUTES.settings}>Settings</Link>.
          </li>
          <li>
            <b>Erase</b> your data and close your account.
          </li>
          <li>
            <b>Object to</b> or <b>restrict</b> processing based on legitimate interest.
          </li>
        </ul>
        <p>
          Write to <Contact /> from the email address on your account. We&apos;ll reply within one month. If you&apos;re unhappy with our answer, you can
          complain to the Spanish data-protection authority, the{" "}
          <a href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">
            Agencia Española de Protección de Datos (AEPD)
          </a>
          , or to the authority in your own EU country.
        </p>
      </Sec>

      <Sec id="security">
        <p>
          Passwords are hashed, traffic is encrypted over HTTPS, and access to the database is restricted to the operator. No online service is perfectly
          secure, though — another reason not to put confidential information into a public demo.
        </p>
      </Sec>

      <Sec id="age">
        <p>The demo is intended for adults (18+) evaluating it for work. Please don&apos;t use it if you&apos;re younger.</p>
      </Sec>

      <Sec id="changes">
        <p>If this policy changes, we&apos;ll update the date at the top of the page. For significant changes we&apos;ll let account holders know.</p>
      </Sec>
    </LegalPage>
  );
}
