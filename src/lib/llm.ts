/**
 * LLM client — provider-agnostic.
 *
 * LLM BOUNDARY: this writes prose only (claim letters, grant applications,
 * agent reasoning). It never receives authority to compute £ figures — those
 * are passed in as facts from the deterministic engine and must be echoed
 * verbatim.
 *
 * Two backends, selected by `LLM_PROVIDER`:
 *   - "anthropic" (default) — Claude via the Anthropic SDK.
 *   - "openai"              — ANY OpenAI-compatible /chat/completions endpoint
 *                             (Modal vLLM, Nebius, Together, OpenAI, …) via
 *                             plain fetch (no extra dependency).
 *
 * To run the whole app on a Modal-hosted model, set:
 *   LLM_PROVIDER=openai
 *   LLM_BASE_URL=https://<your-modal-endpoint>/v1   # must be OpenAI-compatible
 *   LLM_MODEL=<model name the endpoint serves>
 *   LLM_API_KEY=<token if the endpoint requires one>   # optional
 * Everything else (web letters, voice letters, the agent workforce) flows
 * through this module, so nothing else has to change.
 */
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM =
  "You are a concise grant application specialist for UK small businesses. " +
  "Respond only with the content requested — no preamble, no exploratory reasoning, " +
  "no meta-commentary, and no markdown headers unless explicitly asked. " +
  "Any monetary figures provided to you are authoritative — reproduce them exactly, never recalculate.";

export type Provider = "anthropic" | "openai";

export function provider(): Provider {
  return process.env.LLM_PROVIDER === "openai" ? "openai" : "anthropic";
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

// ── OpenAI-compatible backend (fetch, no dependency) ─────────────────────────

function openaiBase(): string {
  const base = process.env.LLM_BASE_URL;
  if (!base) throw new Error("LLM_BASE_URL is not set (required for LLM_PROVIDER=openai)");
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

async function openaiComplete(
  prompt: string,
  opts: { system: string; model: string; maxTokens: number },
): Promise<string> {
  const res = await fetch(`${openaiBase()}/chat/completions`, {
    method: "POST",
    headers: openaiHeaders(),
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
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

// ── Public surface (provider-agnostic) ───────────────────────────────────────

/** Default chat model for the active provider. */
export function model(): string {
  if (provider() === "openai") return process.env.LLM_MODEL || "default";
  return process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
}

/** Fast/cheap model the agent workforce uses for short reasoning/prose. */
export function agentModel(): string {
  if (process.env.STELLA_AGENT_MODEL) return process.env.STELLA_AGENT_MODEL;
  if (provider() === "openai") return process.env.LLM_MODEL || "default";
  return "claude-haiku-4-5";
}

/** True when the active provider is configured (lets callers degrade gracefully). */
export function llmAvailable(): boolean {
  return provider() === "openai" ? Boolean(process.env.LLM_BASE_URL) : Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Stream a completion as SSE — used by the web letter / grant routes. */
export function streamChatResponse(prompt: string, system: string = SYSTEM): Response {
  if (provider() === "openai") return openaiStream(prompt, system, model());

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const messageStream = client().messages.stream({
          model: model(),
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

/** Blocking completion — used by the voice agent where a single string is needed. */
export async function chat(prompt: string, system: string = SYSTEM): Promise<string> {
  if (provider() === "openai") return openaiComplete(prompt, { system, model: model(), maxTokens: 4096 });
  const message = await client().messages.create({
    model: model(),
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Blocking completion with per-call model / token / system overrides. Used by
 * the agent reasoning layer. Throws on error — callers fall back to a
 * deterministic template so the autonomous loop never stalls.
 */
export async function completeWith(
  prompt: string,
  opts: { system: string; model?: string; maxTokens?: number },
): Promise<string> {
  const mdl = opts.model ?? agentModel();
  const maxTokens = opts.maxTokens ?? 700;
  if (provider() === "openai") return openaiComplete(prompt, { system: opts.system, model: mdl, maxTokens });
  const message = await client().messages.create({
    model: mdl,
    max_tokens: maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
