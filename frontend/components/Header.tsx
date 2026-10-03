"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function LogoMark() {
  return (
    <span className="logo-mark">
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="2" width="5" height="20" rx="2.2" fill="currentColor" />
        <rect x="10" y="2" width="12" height="5" rx="2.2" fill="currentColor" opacity="0.85" />
        <rect x="10" y="9.5" width="8" height="5" rx="2.2" fill="currentColor" opacity="0.6" />
        <rect x="10" y="17" width="12" height="5" rx="2.2" fill="currentColor" opacity="0.85" />
      </svg>
    </span>
  );
}

export default function Header() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <header className="site-header">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-8">
        <Link href="/" className="flex items-center gap-2 serif text-xl">
          <LogoMark />
          Ensemblis
        </Link>
        <nav className="hidden sm:flex gap-1 flex-1">
          <Link href="/agents" className="nav-link">
            Agents
          </Link>
          {user && (
            <Link href="/dashboard" className="nav-link">
              Dashboard
            </Link>
          )}
          {user && (
            <Link href="/new" className="nav-link">
              New task
            </Link>
          )}
        </nav>
        <div className="flex-1 sm:hidden" />
        {user ? (
          <div className="flex items-center gap-3 text-sm">
            <span className="chip hidden sm:inline-flex">{user.credits} credits</span>
            <span className="hidden sm:inline text-muted">{user.name}</span>
            <button
              className="btn sm"
              onClick={() => {
                signOut();
                router.push("/");
              }}
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <Link className="btn sm" href="/login">
              Log in
            </Link>
            <Link className="btn p sm" href="/signup">
              Get started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
