"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "@/lib/api";

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<any | null>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      const { task } = await api.getTask(id);
      if (cancelled) return;
      setTask(task);
      if (task.status === "COMPLETED" || task.status === "FAILED") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    }

    poll();
    // The task runs in the background on the server; poll every 2s until it
    // settles. Swap this for Server-Sent Events / websockets for live
    // progress instead of polling once you're past the scaffold stage.
    intervalRef.current = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [id]);

  async function sendFeedback(outcome: "Achieved" | "Partially" | "Not achieved") {
    setSendingFeedback(true);
    try {
      const { task } = await api.sendFeedback(id, outcome);
      setTask(task);
    } finally {
      setSendingFeedback(false);
    }
  }

  if (!task) return <p className="max-w-3xl mx-auto px-6 py-14 text-gray-400">Loading…</p>;

  return (
    <section className="max-w-3xl mx-auto px-6 py-14">
      <h1 className="text-2xl font-semibold mb-2">{task.title}</h1>
      <p className="text-sm text-gray-500 mb-8">
        Status: <span className="text-accent">{task.status}</span>
        {task.agent && ` · ${task.agent.name}`}
      </p>

      {(task.status === "PLANNING" || task.status === "RUNNING") && (
        <div className="card text-gray-400">Working on it — this calls a real model, so it may take a bit.</div>
      )}

      {task.status === "FAILED" && (
        <div className="card border-red-900 text-red-400">
          This task failed: {task.errorMessage}. Your credits were refunded.
        </div>
      )}

      {task.status === "COMPLETED" && (
        <>
          <article className="card prose prose-invert max-w-none mb-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{task.result}</ReactMarkdown>
          </article>

          <div className="card">
            <h3 className="font-medium mb-3">Did this achieve what you needed?</h3>
            <div className="flex gap-3">
              {(["Achieved", "Partially", "Not achieved"] as const).map((o) => (
                <button
                  key={o}
                  className={`btn ${task.outcome === o ? "btn-primary" : ""}`}
                  disabled={sendingFeedback}
                  onClick={() => sendFeedback(o)}
                >
                  {o}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
