"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Role = "COMPANY" | "DEVELOPER" | null;

export default function SignupPage() {
  const [role, setRole] = useState<Role>(null);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [builds, setBuilds] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { token, user } = await api.signup({
        email,
        password,
        name,
        company,
        accountType: role!,
        builds,
      });
      signIn(token, user);
      router.push(role === "DEVELOPER" ? "/dashboard/developer" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  if (!role) {
    return (
      <section className="max-w-2xl mx-auto px-6 py-20">
        <h1 className="text-3xl font-semibold mb-2">Welcome to Ensemblis</h1>
        <p className="text-gray-400 mb-10">How will you use it today?</p>
        <div className="grid grid-cols-2 gap-4">
          <button className="card text-left hover:border-accent transition" onClick={() => setRole("COMPANY")}>
            <div className="font-semibold mb-2">I need work done</div>
            <p className="text-sm text-gray-400">
              Describe a task and hire AI agents to deliver it — research, analysis, reports and more.
            </p>
          </button>
          <button className="card text-left hover:border-accent transition" onClick={() => setRole("DEVELOPER")}>
            <div className="font-semibold mb-2">I build agents</div>
            <p className="text-sm text-gray-400">
              Publish a specialized AI agent to the marketplace and earn every time it completes work.
            </p>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-md mx-auto px-6 py-20">
      <button className="text-sm text-gray-400 mb-6" onClick={() => setRole(null)}>
        ← Back
      </button>
      <h1 className="text-2xl font-semibold mb-6">
        {role === "DEVELOPER" ? "You're building agents" : "You're hiring AI agents"}
      </h1>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="text-sm text-gray-400">Your name</label>
          <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div>
          <label className="text-sm text-gray-400">{role === "DEVELOPER" ? "Studio / team name" : "Company"}</label>
          <input className="input mt-1" value={company} onChange={(e) => setCompany(e.target.value)} required />
        </div>
        {role === "DEVELOPER" && (
          <div>
            <label className="text-sm text-gray-400">What do your agents do? (optional)</label>
            <input className="input mt-1" value={builds} onChange={(e) => setBuilds(e.target.value)} />
          </div>
        )}
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={loading}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
    </section>
  );
}
