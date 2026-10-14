// Passage retrieval over company documents. Deliberately simple: documents
// are split into paragraph-aligned chunks at query time and ranked by a
// BM25-style term score. Organizations hold a handful of documents of at most
// MAX_ATTACHMENT_CHARS each, so this is fast and needs no vector store.
//
// `Retriever` is the seam for a future embedding-based implementation; the
// executor only depends on the interface.

export interface RetrievableDoc {
  id: string;
  name: string;
  kind: string;
  url: string | null;
  text: string;
}

export interface Passage {
  docId: string;
  docName: string;
  kind: string;
  url: string | null;
  text: string;
  score: number;
}

export interface Retriever {
  retrieve(docs: RetrievableDoc[], query: string, k: number): Passage[];
}

const STOP = new Set(
  (
    "a an and are as at be but by can could do does for from had has have how i if in into is it its me my of on or our " +
    "please should so than that the their them then there these they this those to us was we what when where which who " +
    "why will with would you your about also using use need want make find help report analysis analyze analyse provide " +
    "prepare list including include based next our we're"
  ).split(" ")
);

export function terms(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9€$%]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

export function chunkText(text: string, size = 1200): string[] {
  const paras = text.split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (p.length > size) {
      if (cur) out.push(cur);
      cur = "";
      for (let i = 0; i < p.length; i += size) out.push(p.slice(i, i + size));
      continue;
    }
    if (cur.length + p.length + 2 > size) {
      out.push(cur);
      cur = p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

export const keywordRetriever: Retriever = {
  retrieve(docs, query, k) {
    const q = [...new Set(terms(query))];
    if (!q.length || !docs.length) return [];
    const chunks = docs.flatMap((d) => chunkText(d.text).map((text) => ({ d, text, t: terms(text) })));
    const N = chunks.length;
    const df = new Map<string, number>();
    for (const c of chunks) for (const w of new Set(c.t)) df.set(w, (df.get(w) ?? 0) + 1);
    const avgLen = chunks.reduce((n, c) => n + c.t.length, 0) / Math.max(1, N);
    const scored = chunks.map((c) => {
      const tf = new Map<string, number>();
      for (const w of c.t) tf.set(w, (tf.get(w) ?? 0) + 1);
      let score = 0;
      for (const w of q) {
        const f = tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
        score += (idf * (f * 2.2)) / (f + 1.2 * (0.25 + 0.75 * (c.t.length / Math.max(1, avgLen))));
      }
      return { c, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((s) => ({ docId: s.c.d.id, docName: s.c.d.name, kind: s.c.d.kind, url: s.c.d.url, text: s.c.text, score: Math.round(s.score * 100) / 100 }));
  },
};
