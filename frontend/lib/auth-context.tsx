"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, ApiError, getToken, setToken, UNAUTHORIZED_EVENT, type User } from "./api";

export type { User };

interface AuthContextValue {
  user: User | null;
  /** true until the initial /me check has finished */
  loading: boolean;
  /** Store the token + user after api.login / api.signup. */
  signIn: (token: string, user: User) => void;
  signOut: () => void;
  /** Re-fetch the current user from /api/auth/me. */
  refresh: () => Promise<void>;
  /**
   * Replace the user (or update it functionally). Use it after any API call that
   * returns a fresh `user` (createTask, retryTask, runWorkflow, topUp, updateMe)
   * so the header credits pill stays correct:
   *   const { user } = await api.updateMe(...); setUser(user);
   */
  setUser: (u: User | null | ((prev: User | null) => User | null)) => void;
  /** Convenience: set the credit balance (cents) without a round-trip. */
  setCredits: (cents: number) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const { user } = await api.me();
      setUser(user);
    } catch (e) {
      // Only drop the session on an auth failure — keep it on network errors.
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setToken(null);
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Any API call that comes back 401 ends the session everywhere (lib/api.ts
  // already dropped the token); RequireAuth then sends the person to /login.
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const signIn = useCallback((token: string, u: User) => {
    setToken(token);
    setUser(u);
    setLoading(false);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const setCredits = useCallback((cents: number) => {
    setUser((u) => (u ? { ...u, credits: cents } : u));
  }, []);

  const value = useMemo(
    () => ({ user, loading, signIn, signOut, refresh, setUser, setCredits }),
    [user, loading, signIn, signOut, refresh, setCredits]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
