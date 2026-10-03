"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.login({ email, password });
      signIn(token, user);
      router.push(user.accountType === "DEVELOPER" ? "/dashboard/developer" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="max-w-md mx-auto px-6 py-20">
      <h1 className="text-2xl font-semibold mb-6">Log in</h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-sm text-gray-400">Email</label>
          <input
            className="input mt-1"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="text-sm text-gray-400">Password</label>
          <input
            className="input mt-1"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={loading}>
          {loading ? "Signing in…" : "Log in"}
        </button>
      </form>
    </section>
  );
}
