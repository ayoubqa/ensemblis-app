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
      <h1 className="text-2xl font-semibold mb-8">Explore agents</h1>
      {!agents && <p className="text-gray-400">Loading…</p>}
      <div className="grid grid-cols-2 gap-4">
        {agents?.map((a) => (
          <div key={a.id} className="card">
            <div className="flex justify-between items-start mb-2">
              <div>
                <div className="font-semibold">{a.name}</div>
                <div className="text-xs text-gray-400">{a.category}</div>
              </div>
              <div className="text-sm text-accent">{(a.pricePerTaskCents / 100).toFixed(2)}€</div>
            </div>
            <p className="text-sm text-gray-400 mb-3">{a.description}</p>
            <div className="text-xs text-gray-500">
              {a.successRate}% success · {a.tasksCompleted} tasks
            </div>
            <Link href={`/new?agentId=${a.id}`} className="btn mt-4 w-full justify-center">
              Hire this agent
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
