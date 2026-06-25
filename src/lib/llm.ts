/**
 * LLM client — provider-agnostic, with two cost/quality TIERS.
 *
 * LLM BOUNDARY: this writes prose only (claim letters, grant applications,
 * agent reasoning). It never computes £ figures — those are passed in as facts
 * from the deterministic engine and must be echoed verbatim.
 *
 * Two tiers let you spend cleverly (e.g. cheap open model on Modal for the
 * high-volume agent loop, Claude for the customer/council-facing documents):
 *
 *   • QUALITY tier — customer/council artifacts + web/voice letters.
 *       STELLA_ARTIFACT_PROVIDER (anthropic|openai)   default: LLM_PROVIDER or anthropic
 *       STELLA_ARTIFACT_MODEL                          default: claude-opus-4-8 / LLM_MODEL
 *   • FAST tier — short agent reasoning lines in the activity feed.
 *       STELLA_AGENT_PROVIDER (anthropic|openai)       default: LLM_PROVIDER or anthropic
 *       STELLA_AGENT_MODEL                             default: claude-haiku-4-5 / LLM_MODEL
 *
 * When a tier resolves to "openai" it uses ONE OpenAI-compatible connection
 * (LLM_BASE_URL + LLM_MODEL + Modal-Key/Secret or LLM_API_KEY) — e.g. a
 * Modal Managed Inference Endpoint, which serves the OpenAI API under /v1.
 *
 * With no env set, both tiers are Claude (opus for artifacts, haiku for the
 * loop) — i.e. unchanged default behaviour.
 */
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM =
  "You are a concise grant application specialist for UK small businesses. " +
  "Respond only with the content requested — no preamble, no exploratory reasoning, " +
  "no meta-commentary, and no markdown headers unless explicitly asked. " +
  "Any monetary figures provided to you are authoritative — reproduce them exactly, never recalculate.";

export type Provider = "anthropic" | "openai";
export interface Tier {
  provider: Provider;
  model: string;
}

function baseProvider(): Provider {
  return process.env.LLM_PROVIDER === "openai" ? "openai" : "anthropic";
}

function resolveProvider(envName: string): Provider {
  const v = process.env[envName];
  if (v === "openai") return "openai";
  if (v === "anthropic") return "anthropic";
  return baseProvider();
}

export function qualityTier(): Tier {
  const provider = resolveProvider("STELLA_ARTIFACT_PROVIDER");
  const model =
    process.env.STELLA_ARTIFACT_MODEL ??
    (provider === "openai" ? process.env.LLM_MODEL || "default" : process.env.ANTHROPIC_MODEL || "claude-opus-4-8");
  return { provider, model };
}

export function fastTier(): Tier {
  const provider = resolveProvider("STELLA_AGENT_PROVIDER");
  const model =
    process.env.STELLA_AGENT_MODEL ??
    (provider === "openai" ? process.env.LLM_MODEL || "default" : "claude-haiku-4-5");
  return { provider, model };
}

function tierAvailable(t: Tier): boolean {
  return t.provider === "openai" ? Boolean(process.env.LLM_BASE_URL) : Boolean(process.env.ANTHROPIC_API_KEY);
}

export function reasonAvailable(): boolean {
  return tierAvailable(fastTier());
}
export function artifactAvailable(): boolean {
  return tierAvailable(qualityTier());
}

/** Human-readable LLM config for the console header. */
export function llmStatus() {
  const f = fastTier();
  const q = qualityTier();
  return {
    reasoning: { ...f, available: tierAvailable(f) },
    artifacts: { ...q, available: tierAvailable(q) },
  };
}

// ── Anthropic backend ────────────────────────────────────────────────────────

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

async function anthropicComplete(prompt: string, system: string, model: string, maxTokens: number): Promise<string> {
  const message = await client().messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// ── OpenAI-compatible backend (fetch, no dependency) ─────────────────────────

function openaiBase(): string {
  const base = process.env.LLM_BASE_URL;
  if (!base) throw new Error("LLM_BASE_URL is not set (required for an openai-provider tier)");
  return base.replace(/\/$/, "");
}

function openaiHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  // Modal authenticated endpoints use a proxy-token pair (Modal-Key/Modal-Secret),
  // not a Bearer token. Support both so any OpenAI-compatible host works.
  const mk = process.env.MODAL_KEY;
  const ms = process.env.MODAL_SECRET;
  if (mk && ms) {
    h["Modal-Key"] = mk;
    h["Modal-Secret"] = ms;
  }
  const key = process.env.LLM_API_KEY;
  if (key) h.Authorization = `Bearer ${key}`;
  return h;
}

async function openaiComplete(prompt: string, system: string, model: string, maxTokens: number): Promise<string> {
  const res = await fetch(`${openaiBase()}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`openai endpoint http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  return String(json?.choices?.[0]?.message?.content ?? "").trim();
}

/** Stream an OpenAI-compatible completion, re-emitted in Stella's SSE shape. */
function openaiStream(prompt: string, system: string, model: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const res = await fetch(`${openaiBase()}/chat/completions`, {
          method: "POST",
          headers: openaiHeaders(),
          body: JSON.stringify({
            model,
            max_tokens: 4096,
            stream: true,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
          }),
        });
        if (!res.ok || !res.body) throw new Error(`openai endpoint http ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            const m = line.match(/^data: (.*)$/);
            if (!m || m[1] === "[DONE]") continue;
            try {
              const delta = JSON.parse(m[1])?.choices?.[0]?.delta?.content;
              if (delta) send({ t: delta });
            } catch {
              /* ignore keep-alives / partial */
            }
          }
        }
      } catch (e) {
        send({ error: e instanceof Error ? e.message : String(e) });
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

// ── Tier-aware core ──────────────────────────────────────────────────────────

async function complete(prompt: string, system: string, tier: Tier, maxTokens: number): Promise<string> {
  return tier.provider === "openai"
    ? openaiComplete(prompt, system, tier.model, maxTokens)
    : anthropicComplete(prompt, system, tier.model, maxTokens);
}

// ── Public surface ───────────────────────────────────────────────────────────

/** FAST tier — short agent reasoning. Throws on error; callers fall back. */
export function reason(prompt: string, opts: { system: string; maxTokens?: number }): Promise<string> {
  return complete(prompt, opts.system, fastTier(), opts.maxTokens ?? 200);
}

/** QUALITY tier — customer/council artifacts. Throws on error; callers fall back. */
export function artifact(prompt: string, opts: { system: string; maxTokens?: number }): Promise<string> {
  return complete(prompt, opts.system, qualityTier(), opts.maxTokens ?? 800);
}

/** Stream a completion as SSE (web letter / grant routes) — QUALITY tier. */
export function streamChatResponse(prompt: string, system: string = SYSTEM): Response {
  const t = qualityTier();
  if (t.provider === "openai") return openaiStream(prompt, system, t.model);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const messageStream = client().messages.stream({
          model: t.model,
          max_tokens: 4096,
          system,
          messages: [{ role: "user", content: prompt }],
        });
        messageStream.on("text", (delta) => send({ t: delta }));
        await messageStream.finalMessage();
      } catch (e) {
        send({ error: e instanceof Error ? e.message : String(e) });
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Blocking completion (voice agent) — QUALITY tier. */
export function chat(prompt: string, system: string = SYSTEM): Promise<string> {
  return complete(prompt, system, qualityTier(), 4096);
}
