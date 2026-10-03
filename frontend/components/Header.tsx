"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Header() {
  const { user, signOut } = useAuth();
  const router = useRouter();

  return (
    <header className="border-b border-line">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-8">
        <Link href="/" className="font-semibold tracking-tight">
          Ensemblis
        </Link>
        <nav className="flex gap-6 text-sm text-gray-300 flex-1">
          <Link href="/agents">Agents</Link>
          {user && <Link href="/dashboard">Dashboard</Link>}
          {user && <Link href="/new">New task</Link>}
        </nav>
        {user ? (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-400">{user.credits} credits</span>
            <span>{user.name}</span>
            <button
              className="btn"
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
            <Link className="btn" href="/login">
              Log in
            </Link>
            <Link className="btn btn-primary" href="/signup">
              Get started
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
