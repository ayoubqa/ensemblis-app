"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

export default function AgentsPage() {
  const [agents, setAgents] = useState<any[] | null>(null);

  useEffect(() => {
    api.listAgents().then((r) => setAgents(r.agents));
  }, []);

  return (
    <section className="max-w-5xl mx-auto px-6 py-14">
      <div className="pagehead mb-8">
        <h1>Explore agents</h1>
        <p>Specialists for research, sales, finance, marketing and more — pick one or let Ensemblis auto-match.</p>
      </div>
      {!agents && <p className="text-muted">Loading…</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {agents?.map((a) => (
          <div key={a.id} className="card hover:border-ink transition-colors flex flex-col gap-3">
            <div className="flex justify-between items-start gap-3">
              <div>
                <div className="font-semibold">{a.name}</div>
                <span className="tag gray mt-1 inline-flex">{a.category}</span>
              </div>
              <div className="text-sm font-semibold text-accent whitespace-nowrap">
                {(a.pricePerTaskCents / 100).toFixed(2)}€
              </div>
            </div>
            <p className="text-sm text-muted">{a.description}</p>
            <div className="text-xs text-muted pt-2 border-t border-line">
              {a.successRate}% success · {a.tasksCompleted} tasks
            </div>
            <Link href={`/new?agentId=${a.id}`} className="btn w-full justify-center">
              Hire this agent
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
