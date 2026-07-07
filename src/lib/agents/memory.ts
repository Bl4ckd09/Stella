/**
 * Experience memory — the workforce accumulates outcomes and recalls them
 * when making decisions, so runs get smarter as history grows.
 *
 * Memories are TEXT-ONLY inside BusinessState (replayable, serialisable).
 * Embeddings are a server-side cache keyed by memory id and are never part
 * of state. Retrieval is layered with graceful degradation:
 *
 *   1. text-embedding-v4 cosine similarity   (Qwen Cloud /embeddings)
 *   2. qwen3-rerank over the cosine top-k    (DashScope native rerank API)
 *   3. deterministic fallback: most recent same-sector/borough outcomes
 *
 * Any network failure falls through to the next layer — recall never blocks
 * the loop, mirroring the repo's template-fallback principle for LLM calls.
 */
import type { ActionType, AgentEvent, AgentMemory, BusinessState, Deal } from "./types";
import { gbp } from "./format";

// ── Recording (pure) ─────────────────────────────────────────────────────────

const MEMORABLE: Partial<Record<ActionType, (d: Deal) => string>> = {
  qualify: (d) =>
    `${d.business.sector} in ${d.business.borough}: qualified at ${gbp(d.money.estAnnualSaving)}/yr (${d.confidence} confidence).`,
  disqualify: (d) =>
    `${d.business.sector} in ${d.business.borough}: no claimable relief — disqualified after engine scan.`,
  convert: (d) =>
    `${d.business.sector} in ${d.business.borough}: owner converted after seeing the free-route-first offer.`,
  lose: (d) =>
    `${d.business.sector} in ${d.business.borough}: owner declined or chose the free council route.`,
  record_outcome: (d) =>
    `${d.business.sector} in ${d.business.borough}: council decided — ${gbp(d.money.estBackdated)} estimated backdated at stake.`,
};

/** Derive memory drafts from a tick's events (pure; ids from current length). */
export function memoriesFromEvents(state: BusinessState, events: AgentEvent[]): AgentMemory[] {
  const out: AgentMemory[] = [];
  let n = (state.memories ?? []).length;
  for (const e of events) {
    if (e.blocked || !e.dealId) continue;
    const toText = MEMORABLE[e.action];
    if (!toText) continue;
    const deal = state.deals.find((d) => d.id === e.dealId);
    if (!deal) continue;
    n += 1;
    out.push({
      id: `mem-${String(n).padStart(4, "0")}`,
      tick: e.tick,
      agent: e.agent,
      kind: "outcome",
      text: toText(deal),
      sector: deal.business.sector,
      borough: deal.business.borough,
    });
  }
  return out;
}

// ── Embedding + rerank (server-side, cached, fail-soft) ─────────────────────

const embedCache = new Map<string, number[]>();

function dashscopeBase(): string | null {
  const base = (process.env.LLM_BASE_URL ?? "").replace(/\/$/, "");
  return base.includes("dashscope") ? base : null;
}

export function memoryRecallAvailable(): boolean {
  return Boolean(dashscopeBase() && process.env.LLM_API_KEY);
}

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const base = dashscopeBase();
  if (!base || texts.length === 0) return null;
  try {
    const res = await fetch(`${base}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({ model: "text-embedding-v4", input: texts }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rows: { index: number; embedding: number[] }[] = json?.data ?? [];
    if (rows.length !== texts.length) return null;
    const out: number[][] = new Array(texts.length);
    for (const r of rows) out[r.index] = r.embedding;
    return out;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}

/** qwen3-rerank via the DashScope native API; null on any failure. */
async function rerank(query: string, docs: string[], topN: number): Promise<number[] | null> {
  const base = dashscopeBase();
  if (!base) return null;
  try {
    const native = base.replace("/compatible-mode/v1", "");
    const res = await fetch(`${native}/api/v1/services/rerank/text-rerank/text-rerank`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: "qwen3-rerank",
        input: { query, documents: docs },
        parameters: { return_documents: false, top_n: topN },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const results: { index: number }[] = json?.output?.results ?? [];
    if (!results.length) return null;
    return results.map((r) => r.index);
  } catch {
    return null;
  }
}

// ── Recall ───────────────────────────────────────────────────────────────────

export interface Recall {
  /** Formatted block for prompt injection. */
  text: string;
  /** How many memories were recalled (for the feed line). */
  count: number;
  /** Which retrieval layer produced it. */
  via: "embedding+rerank" | "embedding" | "recent";
}

/**
 * Recall up to 3 relevant past outcomes for a deal/action. Semantic when the
 * Qwen APIs are reachable, recency+trait fallback otherwise, null when there
 * is nothing to recall.
 */
export async function recallExperience(
  state: BusinessState,
  deal: Deal,
  action: ActionType,
): Promise<Recall | null> {
  const memories = state.memories ?? [];
  if (memories.length === 0) return null;

  const related = memories.filter(
    (m) => m.sector === deal.business.sector || m.borough === deal.business.borough,
  );
  const pool = related.length >= 3 ? related : memories;

  // Deterministic fallback: most recent related outcomes.
  const recent = [...pool].slice(-3).reverse();
  let picked = recent;
  let via: Recall["via"] = "recent";

  if (memoryRecallAvailable()) {
    const query = `${action} decision for a ${deal.business.sector} business in ${deal.business.borough}`;
    const uncached = pool.filter((m) => !embedCache.has(m.id));
    const vectors = await embedTexts([query, ...uncached.map((m) => m.text)]);
    if (vectors) {
      uncached.forEach((m, i) => embedCache.set(m.id, vectors[i + 1]));
      const q = vectors[0];
      const scored = pool
        .filter((m) => embedCache.has(m.id))
        .map((m) => ({ m, s: cosine(q, embedCache.get(m.id)!) }))
        .sort((x, y) => y.s - x.s)
        .slice(0, 8);
      if (scored.length) {
        picked = scored.slice(0, 3).map((x) => x.m);
        via = "embedding";
        const order = await rerank(query, scored.map((x) => x.m.text), 3);
        if (order) {
          picked = order.map((i) => scored[i]?.m).filter(Boolean);
          via = "embedding+rerank";
        }
      }
    }
  }

  if (!picked.length) return null;
  return {
    text: `Recalled experience (${picked.length} past outcome${picked.length > 1 ? "s" : ""}):\n${picked
      .map((m) => `- ${m.text}`)
      .join("\n")}`,
    count: picked.length,
    via,
  };
}
