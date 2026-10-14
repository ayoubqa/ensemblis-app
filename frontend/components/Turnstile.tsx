"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from "react";
import { useConfig } from "@/lib/config";
import { useTheme } from "@/lib/theme";
import { Icon } from "./Icon";

/**
 * Cloudflare Turnstile bot check (explicit rendering).
 *
 *   const ts = useRef<TurnstileHandle>(null);
 *   const [token, setToken] = useState<string | null>(null);
 *   <Turnstile ref={ts} onToken={setToken} action="signup" />
 *   …after a failed submit: ts.current?.reset()   (tokens are single-use)
 *
 * Renders nothing when the server has no `turnstileSiteKey` — check
 * `useTurnstileEnabled()` before requiring a token. The script is loaded once
 * per page, lazily, only when a widget is actually shown.
 */

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined | null;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}

function getApi(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  const ready = getApi();
  if (ready) return Promise.resolve(ready);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    let s = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    const el = s;
    el.addEventListener(
      "load",
      () => {
        const api = getApi();
        if (api) resolve(api);
        else reject(new Error("Turnstile failed to initialise"));
      },
      { once: true }
    );
    el.addEventListener(
      "error",
      () => {
        el.remove(); // allow a clean retry
        reject(new Error("Turnstile script failed to load"));
      },
      { once: true }
    );
  }).catch((e) => {
    scriptPromise = null;
    throw e;
  });
  return scriptPromise;
}

/** true when the server requires a Turnstile token (guest trial + sign-up). */
export function useTurnstileEnabled(): boolean {
  return !!useConfig().config.turnstileSiteKey;
}

export interface TurnstileHandle {
  /** Clear the current token and run a fresh challenge (call after a failed submit). */
  reset: () => void;
}

export interface TurnstileProps {
  /** Receives the token when solved, and `null` whenever it expires, errors or resets. */
  onToken: (token: string | null) => void;
  /** Analytics label shown in the Cloudflare dashboard (a-z, 0-9, - and _ only). */
  action?: string;
  className?: string;
  style?: CSSProperties;
}

type Status = "loading" | "ready" | "error" | "failed";

export const Turnstile = forwardRef<TurnstileHandle, TurnstileProps>(function Turnstile({ onToken, action, className, style }, ref) {
  const siteKey = useConfig().config.turnstileSiteKey;
  const { resolved } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  const reset = useCallback(() => {
    onTokenRef.current(null);
    const api = getApi();
    if (api && widgetId.current) {
      try {
        api.reset(widgetId.current);
        setStatus("ready");
        return;
      } catch {
        /* fall through to a full re-render */
      }
    }
    setAttempt((a) => a + 1);
  }, []);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    let id: string | null = null;
    let autoRetried = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    setStatus("loading");
    loadTurnstile()
      .then((api) => {
        const el = box.current;
        if (cancelled || !el) return;
        // Follow the site theme (the attribute is set before paint, so it is always current).
        const theme = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
        const rendered = api.render(el, {
          sitekey: siteKey,
          theme,
          size: el.clientWidth >= 300 ? "flexible" : "compact",
          appearance: "always",
          "refresh-expired": "manual",
          "response-field": false,
          ...(action ? { action } : {}),
          callback: (token: string) => {
            if (cancelled) return;
            setStatus("ready");
            onTokenRef.current(token);
          },
          "expired-callback": () => {
            if (cancelled) return;
            onTokenRef.current(null);
            try {
              if (id) api.reset(id);
            } catch {
              /* widget already gone */
            }
          },
          "timeout-callback": () => {
            if (cancelled) return;
            onTokenRef.current(null);
            try {
              if (id) api.reset(id);
            } catch {
              /* widget already gone */
            }
          },
          "error-callback": () => {
            if (cancelled) return true;
            onTokenRef.current(null);
            setStatus("error");
            // Reset once automatically (transient network hiccups); after that the visible "Try again" takes over.
            if (!autoRetried) {
              autoRetried = true;
              retryTimer = setTimeout(() => {
                if (cancelled || !id) return;
                try {
                  api.reset(id);
                  setStatus("ready");
                } catch {
                  /* widget already gone */
                }
              }, 2000);
            }
            return true; // handled: we show our own retry
          },
        });
        id = rendered || null;
        widgetId.current = id;
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      onTokenRef.current(null);
      const api = getApi();
      if (api && id) {
        try {
          api.remove(id);
        } catch {
          /* already removed */
        }
      }
      if (widgetId.current === id) widgetId.current = null;
    };
  }, [siteKey, resolved, action, attempt]);

  if (!siteKey) return null;

  return (
    <div className={className ? `au-ts ${className}` : "au-ts"} style={style}>
      {/* Owned by Turnstile — React never renders children into it. */}
      <div ref={box} className="au-ts-box" aria-label="Security check" role="group" />
      {status === "loading" && (
        <div className="au-ts-loading" aria-live="polite">
          <span className="spin" aria-hidden="true" />
          Loading a quick security check…
        </div>
      )}
      {status === "error" && (
        <div className="au-ts-error" role="alert">
          <Icon name="alert" size={15} />
          <span>The security check didn&apos;t complete.</span>
          <button type="button" className="btn sm" onClick={reset}>
            Try again
          </button>
        </div>
      )}
      {status === "failed" && (
        <div className="au-ts-failed" role="alert">
          <Icon name="alert" />
          <span>Couldn&apos;t load the security check. Check your connection or pause content blockers for this site, then try again.</span>
          <button type="button" className="btn sm" onClick={() => setAttempt((a) => a + 1)}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
});

export default Turnstile;
