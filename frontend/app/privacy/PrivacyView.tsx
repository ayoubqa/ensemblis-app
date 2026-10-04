"use client";

import Link from "next/link";
import { ROUTES } from "@/lib/routes";
import { AiProvider, Contact, LegalPage, Sec } from "../_legal/LegalBits";

export function PrivacyView() {
  return (
    <LegalPage
      title="Privacy Policy"
      other="terms"
      intro="Ensemblis is a free public demo of an AI-agent marketplace, run by an individual based in Spain. This page explains, in plain language, what personal data it handles and what you can do about it."
      summary={[
        "We collect only what's needed to run the demo: your account details, the tasks you submit, the AI results, and your demo-credit history.",
        <>
          The text of your tasks is sent to our AI provider (<AiProvider />) to generate results.
        </>,
        "No advertising, no ad trackers, no selling of data. Your browser stores a login token so you stay signed in.",
        <>
          You can ask for a copy of your data or for it to be deleted at any time by writing to <Contact />.
        </>,
      ]}
    >
      <Sec id="who" title="1. Who is responsible">
        <p>
          The data controller is the individual who operates this Ensemblis demo, based in Spain (European Union). Ensemblis is a personal project, not a
          registered company. You can reach the operator at <Contact />.
        </p>
      </Sec>

      <Sec id="what" title="2. What we collect and why">
        <div className="tw" style={{ margin: "6px 0 10px" }}>
          <table>
            <thead>
              <tr>
                <th>Data</th>
                <th>Why</th>
                <th>Legal basis (GDPR)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>Account details</b> — name, email, and optionally company, role, and (for developers) what your agents do
                </td>
                <td>To create your account, sign you in and show your profile</td>
                <td>Performing our agreement with you (Art. 6(1)(b))</td>
              </tr>
              <tr>
                <td>
                  <b>Password</b> — stored only as a one-way hash, never in readable form
                </td>
                <td>To secure your account</td>
                <td>Art. 6(1)(b)</td>
              </tr>
              <tr>
                <td>
                  <b>Task content</b> — the descriptions you write, the plans and AI-generated outputs, your feedback, and recurring workflows you set up
                </td>
                <td>To run your tasks and show you the results</td>
                <td>Art. 6(1)(b)</td>
              </tr>
              <tr>
                <td>
                  <b>Usage and credit records</b> — which tasks ran, when, their cost in demo credits, top-ups and refunds
                </td>
                <td>To run the demo-credit system, apply fair-use limits and prevent abuse</td>
                <td>Art. 6(1)(b) and our legitimate interest in keeping the service working (Art. 6(1)(f))</td>
              </tr>
              <tr>
                <td>
                  <b>Agents you publish</b> (developers) — name, description, capabilities, pricing and instructions
                </td>
                <td>To list your agent in the marketplace and run it. The listing is public; your agent&apos;s instructions are not shown to customers.</td>
                <td>Art. 6(1)(b)</td>
              </tr>
              <tr>
                <td>
                  <b>Technical logs</b> — IP address, browser type and request times, recorded by the hosting infrastructure
                </td>
                <td>Security, debugging and preventing abuse</td>
                <td>Legitimate interest (Art. 6(1)(f))</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We don&apos;t ask for, and you shouldn&apos;t submit, sensitive data (health, religion, political views, etc.) or other people&apos;s personal data. See
          the <Link href={ROUTES.terms}>Terms</Link>.
        </p>
      </Sec>

      <Sec id="browser" title="3. What's stored in your browser">
        <p>We don&apos;t use advertising or analytics trackers. The site stores only what it needs to work:</p>
        <ul>
          <li>
            <b>A login token</b> in your browser&apos;s local storage, so you stay signed in. Logging out removes it.
          </li>
          <li>Small preferences such as your light/dark theme choice, which notifications you&apos;ve read, and whether you closed the demo banner.</li>
        </ul>
        <p>These are strictly necessary for the service you asked for, so they don&apos;t require a consent banner.</p>
      </Sec>

      <Sec id="sharing" title="4. Who receives your data">
        <p>We never sell your data or use it for advertising. To run the demo we rely on a few service providers who process data on our behalf:</p>
        <ul>
          <li>
            <b>Hosting provider</b> — serves the website and the application server.
          </li>
          <li>
            <b>Database provider</b> — stores accounts, tasks, results and credit records.
          </li>
          <li>
            <b>AI provider: <AiProvider /></b> — when you run a task, its description and the intermediate steps are sent to this provider so its models
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

      <Sec id="retention" title="5. How long we keep it">
        <ul>
          <li>Account data, tasks and results are kept while your account exists.</li>
          <li>
            You can ask for your account and everything in it to be deleted at any time. We&apos;ll do it within 30 days; residual copies in backups expire
            on their normal cycle.
          </li>
          <li>Because this is a demo, data may be reset or deleted at any time, and everything is deleted if the demo is shut down.</li>
          <li>Technical logs are kept only briefly by the hosting infrastructure, as part of its normal operation.</li>
        </ul>
      </Sec>

      <Sec id="rights" title="6. Your rights">
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

      <Sec id="security" title="7. Security">
        <p>
          Passwords are hashed, traffic is encrypted over HTTPS, and access to the database is restricted to the operator. No online service is perfectly
          secure, though — another reason not to put confidential information into a public demo.
        </p>
      </Sec>

      <Sec id="age" title="8. Age">
        <p>The demo is intended for adults (18+) evaluating it for work. Please don&apos;t use it if you&apos;re younger.</p>
      </Sec>

      <Sec id="changes" title="9. Changes to this policy">
        <p>If this policy changes, we&apos;ll update the date at the top of the page. For significant changes we&apos;ll let account holders know.</p>
      </Sec>
    </LegalPage>
  );
}
