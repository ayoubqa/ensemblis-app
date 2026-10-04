"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, Icon } from "@/components";
import { api, type Agent, type AgentListQuery } from "@/lib/api";
import { plural } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { ROUTES } from "@/lib/routes";
import { AgentCard, AgentCardSkeleton, newTaskUrl } from "./AgentCard";

type Sort = NonNullable<AgentListQuery["sort"]>;
interface Filters {
  q: string;
  cat: string; // "All" or a category name
  price: string; // "any" | max euros
  rating: string; // "any" | min rating
  verified: boolean;
  sort: Sort;
}

const DEFAULTS: Filters = { q: "", cat: "All", price: "any", rating: "any", verified: false, sort: "recommended" };
const SORTS: [Sort, string][] = [
  ["recommended", "Recommended"],
  ["rating", "Top rated"],
  ["price", "Price: low to high"],
  ["tasks", "Most tasks"],
  ["newest", "Newest"],
];
const PRICES = ["15", "25", "40"];
const RATINGS = ["4.5", "4.7", "4.8"];

function fromParams(p: URLSearchParams): Filters {
  const sort = p.get("sort") as Sort | null;
  const price = p.get("price");
  const rating = p.get("rating");
  return {
    q: p.get("q") ?? "",
    cat: p.get("category") || "All",
    price: price && PRICES.includes(price) ? price : "any",
    rating: rating && RATINGS.includes(rating) ? rating : "any",
    verified: p.get("verified") === "1" || p.get("verified") === "true",
    sort: sort && SORTS.some(([s]) => s === sort) ? sort : "recommended",
  };
}

function toQS(f: Filters): string {
  const q = new URLSearchParams();
  if (f.q.trim()) q.set("q", f.q.trim());
  if (f.cat !== "All") q.set("category", f.cat);
  if (f.price !== "any") q.set("price", f.price);
  if (f.rating !== "any") q.set("rating", f.rating);
  if (f.verified) q.set("verified", "1");
  if (f.sort !== "recommended") q.set("sort", f.sort);
  return q.toString();
}

export function ExploreFallback() {
  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Explore AI capabilities.</h1>
      </div>
      <div className="sk" style={{ height: 48, borderRadius: 12 }} />
      <div className="grid g3" style={{ marginTop: 74 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <AgentCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function Explore() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [f, setF] = useState<Filters>(() => fromParams(new URLSearchParams(params.toString())));
  const dq = useDebounced(f.q, 220);
  const lastWritten = useRef<string>(params.toString());

  // External navigation (e.g. a header link to /agents?q=…) → adopt the URL.
  useEffect(() => {
    const s = params.toString();
    if (s === lastWritten.current) return;
    lastWritten.current = s;
    setF(fromParams(new URLSearchParams(s)));
  }, [params]);

  // Filters → URL (search text only once it settles).
  useEffect(() => {
    const s = toQS({ ...f, q: dq });
    if (s === lastWritten.current) return;
    lastWritten.current = s;
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [f, dq, pathname, router]);

  const set = useCallback(<K extends keyof Filters>(k: K, v: Filters[K]) => setF((p) => ({ ...p, [k]: v })), []);

  // Category list + counts come from the unfiltered marketplace.
  const [all, setAll] = useState<{ agents: Agent[]; categories: string[] } | null>(null);
  useEffect(() => {
    api.listAgents().then(setAll, () => {});
  }, []);

  // Server-side query: search, category, verified, sort.
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const reqId = useRef(0);
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    api
      .listAgents({
        q: dq.trim() || undefined,
        category: f.cat === "All" ? undefined : f.cat,
        sort: f.sort,
        verified: f.verified || undefined,
      })
      .then(
        (r) => {
          if (id !== reqId.current) return;
          setAgents(r.agents);
          setLoading(false);
        },
        (e: Error) => {
          if (id !== reqId.current) return;
          setError(e.message);
          setLoading(false);
        }
      );
  }, [dq, f.cat, f.sort, f.verified, reload]);

  // Client-side: price + rating.
  const results = useMemo(() => {
    if (!agents) return null;
    return agents.filter(
      (a) => (f.price === "any" || a.pricePerTaskCents <= Number(f.price) * 100) && (f.rating === "any" || a.rating >= Number(f.rating))
    );
  }, [agents, f.price, f.rating]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    all?.agents.forEach((a) => m.set(a.category, (m.get(a.category) ?? 0) + 1));
    return m;
  }, [all]);
  const cats = useMemo(() => {
    const c = all?.categories ?? [];
    return f.cat !== "All" && !c.includes(f.cat) ? [...c, f.cat] : c;
  }, [all, f.cat]);

  const filtered = toQS(f) !== "" && toQS({ ...f, sort: "recommended" }) !== "";
  const clear = () => setF({ ...DEFAULTS, sort: f.sort });
  const searchRef = useRef<HTMLInputElement>(null);

  return (
    <div className="wrap">
      <div className="pagehead">
        <h1>Explore AI capabilities.</h1>
        <p>
          Most work never needs browsing: describe it and Ensemblis assembles the team. This is where you can see who&apos;s available and how
          they perform.
        </p>
        <div style={{ marginTop: 14 }}>
          <Link className="btn p" href={ROUTES.newTask}>
            <Icon name="plus" />
            New task
          </Link>
        </div>
      </div>

      <div style={{ position: "relative" }} role="search">
        <label htmlFor="agent-q" className="sr-only">
          Search agents
        </label>
        <input
          ref={searchRef}
          id="agent-q"
          className="f"
          type="search"
          autoComplete="off"
          placeholder="What capability are you looking for?"
          value={f.q}
          onChange={(e) => set("q", e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && f.q) {
              e.preventDefault();
              e.stopPropagation();
              set("q", "");
            }
          }}
          style={{ paddingLeft: 40, paddingRight: f.q ? 44 : undefined, fontSize: 16 }}
        />
        <span style={{ position: "absolute", left: 13, top: 12, color: "var(--muted)", pointerEvents: "none" }}>
          <Icon name="search" />
        </span>
        {f.q && (
          <button
            type="button"
            className="ibtn"
            aria-label="Clear search"
            onClick={() => {
              set("q", "");
              searchRef.current?.focus();
            }}
            style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32 }}
          >
            <Icon name="x" />
          </button>
        )}
      </div>

      <div className="row wrapflex" style={{ gap: 8, margin: "14px 0" }} role="group" aria-label="Category">
        {["All", ...cats].map((c) => {
          const n = c === "All" ? all?.agents.length : counts.get(c);
          const on = f.cat === c;
          return (
            <button key={c} type="button" className={on ? "chip on" : "chip"} aria-pressed={on} onClick={() => set("cat", c)}>
              {c}
              {n !== undefined && (
                <span style={{ opacity: 0.6, fontWeight: 500, marginLeft: 2 }} aria-label={`, ${n} agents`}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
        {!all && [70, 90, 60, 80].map((w, i) => <span key={i} className="sk" style={{ width: w, height: 32, borderRadius: 999 }} aria-hidden="true" />)}
      </div>

      <div className="row wrapflex" style={{ gap: 10, marginBottom: 18 }}>
        <select className="f" style={{ width: "auto" }} aria-label="Maximum price" value={f.price} onChange={(e) => set("price", e.target.value)}>
          <option value="any">Any price</option>
          {PRICES.map((p) => (
            <option key={p} value={p}>
              Up to €{p}
            </option>
          ))}
        </select>
        <select className="f" style={{ width: "auto" }} aria-label="Minimum rating" value={f.rating} onChange={(e) => set("rating", e.target.value)}>
          <option value="any">Any rating</option>
          {RATINGS.map((r) => (
            <option key={r} value={r}>
              {r}+
            </option>
          ))}
        </select>
        <label className={f.verified ? "chip on" : "chip"} style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={f.verified} onChange={(e) => set("verified", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
          <Icon name="shield" />
          Fully verified
        </label>
        <div className="sp" />
        <select className="f" style={{ width: "auto" }} aria-label="Sort agents" value={f.sort} onChange={(e) => set("sort", e.target.value as Sort)}>
          {SORTS.map(([v, l]) => (
            <option key={v} value={v}>
              Sort: {l}
            </option>
          ))}
        </select>
      </div>

      <div className="row between wrapflex small" style={{ marginBottom: 12, minHeight: 28 }}>
        <span className="muted" aria-live="polite">
          {results ? (
            <>
              <b style={{ color: "var(--ink)" }}>{plural(results.length, "agent")}</b>
              {f.cat !== "All" && <> in {f.cat}</>}
              {dq.trim() && <> matching “{dq.trim()}”</>}
              {loading && <span className="spin" style={{ marginLeft: 8, width: 12, height: 12, display: "inline-block", verticalAlign: -1 }} aria-hidden="true" />}
            </>
          ) : (
            "Loading agents…"
          )}
        </span>
        {filtered && (
          <button type="button" className="btn sm ghost" onClick={clear}>
            <Icon name="x" />
            Clear filters
          </button>
        )}
      </div>

      {error && !results ? (
        <div className="notice" style={{ background: "var(--bad-soft)", color: "var(--bad)" }} role="alert">
          <Icon name="alert" />
          <span className="sp">{error}</span>
          <button type="button" className="btn sm" onClick={() => setReload((n) => n + 1)}>
            <Icon name="redo" />
            Try again
          </button>
        </div>
      ) : !results ? (
        <div className="grid g3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <AgentCardSkeleton key={i} />
          ))}
        </div>
      ) : results.length === 0 ? (
        <EmptyState
          icon="search"
          title="No agents match those filters."
          action={
            <div className="row wrapflex" style={{ justifyContent: "center", marginTop: 12 }}>
              <button type="button" className="btn" onClick={clear}>
                Clear filters
              </button>
              <Link className="btn p" href={newTaskUrl({ text: dq.trim() || undefined })}>
                Describe the work
                <Icon name="arrow" />
              </Link>
            </div>
          }
        >
          Clear a filter, or describe the work and let Ensemblis choose.
        </EmptyState>
      ) : (
        <div className="grid g3" style={{ opacity: loading ? 0.55 : 1, transition: "opacity .15s" }}>
          {results.map((a, i) => (
            <AgentCard key={a.id} agent={a} query={dq} style={i < 12 ? { animation: `rv .4s ease ${i * 30}ms both` } : undefined} />
          ))}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="dcard row wrapflex" style={{ marginTop: 28, gap: 14 }}>
          <span style={{ color: "var(--accent)" }}>
            <Icon name="spark" />
          </span>
          <div className="sp" style={{ minWidth: 220 }}>
            <b className="small">Not sure who to pick?</b>
            <div className="tiny muted">Describe the outcome. Ensemblis matches the right agents on track record, price and speed.</div>
          </div>
          <Link className="btn sm p" href={ROUTES.newTask}>
            Describe the work
            <Icon name="arrow" />
          </Link>
        </div>
      )}
    </div>
  );
}
