"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Icon, Modal } from "@/components";
import { Turnstile, type TurnstileHandle } from "@/components/Turnstile";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config";
import { errorText } from "@/lib/errors";
import { eur } from "@/lib/format";
import { ROUTES } from "@/lib/routes";

/**
 * "Try without signing up": consent (+ Turnstile when configured) →
 * api.guestStart → signIn → the normal Define-an-outcome page. A guest
 * objective goes through the same plan → approve → execute → verify loop.
 */
export function TrialModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { signIn } = useAuth();
  const { config } = useConfig();
  const [agreed, setAgreed] = useState(false);
  const [tsToken, setTsToken] = useState<string | null>(null);
  const ts = useRef<TurnstileHandle>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tsRequired = !!config.turnstileSiteKey;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed || (tsRequired && !tsToken) || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await api.guestStart({ acceptedTerms: true, ...(tsToken ? { turnstileToken: tsToken } : {}) });
      signIn(token, user);
      onClose();
      router.push(ROUTES.newObjective);
    } catch (err) {
      ts.current?.reset();
      const msg = errorText(err, "We couldn't start a trial right now.");
      setError(/bot check/i.test(msg) ? "The security check didn't complete. Please try it again." : msg);
      setBusy(false);
    }
  };

  // Why the button is still disabled (shown under it, so nobody is left guessing).
  const waiting = !agreed ? "Agree to the Terms and Privacy Policy to start." : tsRequired && !tsToken ? "Complete the security check to start." : null;

  return (
    <Modal open={open} onClose={onClose} title="Try Ensemblis without an account" className="au-trial" dismissible={!busy}>
      <form onSubmit={submit}>
        <p className="au-trial-lead">See how Ensemblis takes an objective from plan to verified outcome — no sign-up needed.</p>
        <ul className="au-points">
          <li>
            <Icon name="building" />
            <span>
              A temporary organization with <b>{eur(config.guestCreditsCents)}</b> of trial balance.
            </span>
          </li>
          <li>
            <Icon name="check" />
            <span>Define one objective. The Chief of Staff plans it, and you approve the plan before any work starts.</span>
          </li>
          <li>
            <Icon name="clock" />
            <span>Kept for 7 days. Create an account any time to keep everything.</span>
          </li>
        </ul>
        <label className="au-check" htmlFor="trial-agree">
          <input id="trial-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
          <span>
            I agree to the{" "}
            <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer">
              Terms<span className="sr-only"> (opens in a new tab)</span>
            </a>{" "}
            and{" "}
            <a href={ROUTES.privacy} target="_blank" rel="noopener noreferrer">
              Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </span>
        </label>
        <Turnstile ref={ts} onToken={setTsToken} action="guest-start" />
        {error && (
          <div className="au-notice bad" role="alert">
            <Icon name="alert" size={16} />
            <div>
              {error} <Link href={ROUTES.signup}>Create a free account instead</Link>
            </div>
          </div>
        )}
        <button type="submit" className="btn p lg au-submit" disabled={!agreed || (tsRequired && !tsToken) || busy} aria-busy={busy}>
          {busy ? "Starting your trial…" : "Start the trial"}
          {!busy && <Icon name="arrow" />}
        </button>
        {waiting && !busy && <p className="au-fine">{waiting}</p>}
      </form>
    </Modal>
  );
}
