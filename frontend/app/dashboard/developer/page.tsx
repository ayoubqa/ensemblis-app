"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";

export default function DeveloperDashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [myAgents, setMyAgents] = useState<any[] | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "Research",
    description: "",
    systemPrompt: "",
    pricePerTaskCents: 1500,
  });
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [loading, user, router]);

  async function loadMine() {
    const { agents } = await api.listMyAgents();
    setMyAgents(agents);
  }

  useEffect(() => {
    if (user) loadMine();
  }, [user]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPublishing(true);
    try {
      await api.publishAgent(form);
      setForm({ name: "", category: "Research", description: "", systemPrompt: "", pricePerTaskCents: 1500 });
      await loadMine();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPublishing(false);
    }
  }

  if (loading || !user) return null;

  return (
    <section className="max-w-4xl mx-auto px-6 py-14">
      <h1 className="serif text-2xl mb-2">Build once. Earn every time it works.</h1>
      <p className="text-muted mb-10">
        {user.company} · {myAgents?.length ?? 0} agent{myAgents?.length === 1 ? "" : "s"} published
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
        <div>
          <h2 className="text-sm text-muted uppercase tracking-wide mb-3">My agents</h2>
          <div className="space-y-3">
            {myAgents?.map((a) => (
              <div key={a.id} className="card">
                <div className="font-medium">{a.name}</div>
                <div className="text-xs text-muted">
                  {a.tasksCompleted} tasks · {a.successRate}% success
                </div>
              </div>
            ))}
            {myAgents?.length === 0 && <p className="text-sm text-muted">Publish your first agent →</p>}
          </div>
        </div>

        <div>
          <h2 className="text-sm text-muted uppercase tracking-wide mb-3">Publish an agent</h2>
          <form onSubmit={publish} className="space-y-3 card">
            <input
              className="input"
              placeholder="Agent name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
            <input
              className="input"
              placeholder="Category (e.g. Research)"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              required
            />
            <textarea
              className="input"
              rows={2}
              placeholder="Description customers see"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
            <textarea
              className="input"
              rows={4}
              placeholder="System prompt — the real instructions sent to Claude for this agent's persona"
              value={form.systemPrompt}
              onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
              required
            />
            <input
              className="input"
              type="number"
              placeholder="Price per task (cents)"
              value={form.pricePerTaskCents}
              onChange={(e) => setForm({ ...form, pricePerTaskCents: Number(e.target.value) })}
              required
            />
            {error && <p className="text-sm text-bad">{error}</p>}
            <button className="btn btn-primary w-full justify-center" disabled={publishing}>
              {publishing ? "Publishing…" : "Publish agent"}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
