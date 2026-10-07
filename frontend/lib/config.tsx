"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type PublicConfig } from "./api";
import { STARTING_CREDITS_CENTS } from "./data";
import { eur } from "./format";

/**
 * Public deployment settings (GET /api/config), fetched once on load.
 *
 *   const { config, loaded } = useConfig();
 *   if (config.demoMode) …
 *
 * Never blocks rendering: until the request returns (or if it fails) the
 * safe fallback below is used — not a demo, no invite needed, top-ups on.
 */
export const FALLBACK_CONFIG: PublicConfig = {
  demoMode: false,
  inviteRequired: false,
  topupEnabled: false,
  topupMaxCents: 0,
  startingCreditsCents: STARTING_CREDITS_CENTS,
  maxTasksPerUserPerDay: 0, // 0 = unknown / not shown
  maxDescriptionLength: 4000,
  aiProviderLabel: "a third-party AI model provider",
  mockAI: false,
  verificationCostCents: 150,
  // Optional features stay hidden until the server says they're on.
  searchEnabled: false,
  searchProviderLabel: "Off",
  emailEnabled: false,
  paymentsEnabled: false,
  creditPacks: [],
  guestTrialEnabled: false,
  guestCreditsCents: 0,
  turnstileSiteKey: null,
  maxAttachments: 3,
  maxAttachmentChars: 40000,
};

interface ConfigContextValue {
  config: PublicConfig;
  /** true once /api/config answered successfully */
  loaded: boolean;
}

const ConfigContext = createContext<ConfigContextValue>({ config: FALLBACK_CONFIG, loaded: false });

let cached: PublicConfig | null = null;
let inflight: Promise<PublicConfig | null> | null = null;

function loadConfig(): Promise<PublicConfig | null> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = api
      .config()
      .then((c) => {
        // Merge over the fallback so a partially-implemented backend can't leave holes.
        cached = { ...FALLBACK_CONFIG, ...c };
        return cached;
      })
      .catch(() => {
        inflight = null; // allow a later retry (e.g. next navigation remount)
        return null;
      });
  }
  return inflight;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfigContextValue>(() => (cached ? { config: cached, loaded: true } : { config: FALLBACK_CONFIG, loaded: false }));

  useEffect(() => {
    if (state.loaded) return;
    let alive = true;
    loadConfig().then((c) => {
      if (alive && c) setState({ config: c, loaded: true });
    });
    return () => {
      alive = false;
    };
  }, [state.loaded]);

  return <ConfigContext.Provider value={state}>{children}</ConfigContext.Provider>;
}

export function useConfig(): ConfigContextValue {
  return useContext(ConfigContext);
}

/** Contact address for legal pages (NEXT_PUBLIC_CONTACT_EMAIL, inlined at build time). */
export const CONTACT_EMAIL = (process.env.NEXT_PUBLIC_CONTACT_EMAIL || "").trim();

/** Inline "€100"-style amount of starting demo credits, from the server config. */
export function StartingCredits() {
  const { config } = useConfig();
  return <>{eur(config.startingCreditsCents)}</>;
}
