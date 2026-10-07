"use client";

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
      setError(errorText(err, "We couldn't start a trial right now. Create a free account instead."));
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Try Ensemblis without an account">
      <form onSubmit={submit}>
        <ul className="small" style={{ paddingLeft: 18, margin: "8px 0 14px" }}>
          <li>
            A temporary organization with {eur(config.guestCreditsCents)} of trial balance — enough for one execution.
          </li>
          <li>Define one objective; the Chief of Staff plans it and you approve before anything runs.</li>
          <li>Kept for 7 days. Create an account any time to keep everything.</li>
        </ul>
        <label className="row" style={{ alignItems: "flex-start", gap: 10 }} htmlFor="trial-agree">
          <input id="trial-agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={busy} />
          <span className="small">
            I agree to the{" "}
            <a href={ROUTES.terms} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              Terms
            </a>{" "}
            and{" "}
            <a href={ROUTES.privacy} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>
              Privacy Policy
            </a>
          </span>
        </label>
        <Turnstile ref={ts} onToken={setTsToken} action="guest-start" />
        {error && (
          <p className="err" role="alert" style={{ marginTop: 10 }}>
            {error}
          </p>
        )}
        <button type="submit" className="btn p" style={{ width: "100%", marginTop: 16 }} disabled={!agreed || (tsRequired && !tsToken) || busy} aria-busy={busy}>
          Start the trial
          <Icon name="arrow" />
        </button>
      </form>
    </Modal>
  );
}
