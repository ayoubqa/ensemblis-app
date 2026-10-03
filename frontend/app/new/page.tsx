"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

export default function NewTaskPage() {
  return (
    <Suspense fallback={null}>
      <NewTaskForm />
    </Suspense>
  );
}

function NewTaskForm() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState(params.get("agentId") || "");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) router.push(`/login?next=/new`);
  }, [loading, user, router]);

  useEffect(() => {
    api.listAgents().then((r) => setAgents(r.agents));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const title = description.split(".")[0].slice(0, 80) || "Untitled task";
      const { task } = await api.createTask({ title, description, agentId: agentId || undefined });
      router.push(`/tasks/${task.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !user) return null;

  return (
    <section className="max-w-2xl mx-auto px-6 py-14">
      <h1 className="text-3xl font-semibold mb-2">What do you need done?</h1>
      <p className="text-gray-400 mb-8">
        Describe the work. This actually gets sent to the Claude API — no simulation.
      </p>
      <form onSubmit={submit} className="space-y-4">
        <textarea
          className="input"
          rows={5}
          placeholder="Analyze the top 10 competitors in the European data center cooling market and summarize their pricing and positioning."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />
        <div>
          <label className="text-sm text-gray-400">Agent (optional — leave blank to auto-match)</label>
          <select className="input mt-1" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">Auto-match</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {(a.pricePerTaskCents / 100).toFixed(2)}€
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className="btn btn-primary w-full justify-center" disabled={submitting}>
          {submitting ? "Starting…" : "Start task"}
        </button>
      </form>
    </section>
  );
}
