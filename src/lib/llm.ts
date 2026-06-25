/**
 * LLM client — Claude API (Anthropic SDK).
 * Replaces the original DGX Spark / Ollama client (agent/llm.py).
 *
 * LLM BOUNDARY: this writes prose only (claim letters, grant applications).
 * It never receives authority to compute £ figures — those are passed in as
 * facts from the deterministic engine and must be echoed verbatim.
 */
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM =
  "You are a concise grant application specialist for UK small businesses. " +
  "Respond only with the content requested — no preamble, no exploratory reasoning, " +
  "no meta-commentary, and no markdown headers unless explicitly asked. " +
  "Any monetary figures provided to you are authoritative — reproduce them exactly, never recalculate.";

let _client: Anthropic | null = null;

function client(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");
  _client = new Anthropic({ apiKey });
  return _client;
}

export function model(): string {
  // Defaults to the most capable model; override with ANTHROPIC_MODEL
  // (e.g. claude-haiku-4-5) to trade quality for cost on high volume.
  return process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
}

/**
 * Stream a completion as Server-Sent Events. Returns a Response suitable for
 * returning directly from a Next.js route handler. Mirrors the original SSE
 * shape: `data: {"t": "chunk"}` ... `data: [DONE]`.
 */
export function streamChatResponse(prompt: string, system: string = SYSTEM): Response {
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

/** True when an Anthropic key is configured (lets callers degrade gracefully). */
export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Model used by the autonomous agent workforce for short reasoning/prose. The
 * loop ticks frequently, so this defaults to a fast, cheap model; override with
 * STELLA_AGENT_MODEL (e.g. claude-opus-4-8 for top-quality artifacts).
 */
export function agentModel(): string {
  return process.env.STELLA_AGENT_MODEL || "claude-haiku-4-5";
}

/**
 * Blocking completion with per-call model / token / system overrides. Used by
 * the agent reasoning layer. Throws on API error — callers fall back to a
 * deterministic template so the autonomous loop never stalls.
 */
export async function completeWith(
  prompt: string,
  opts: { system: string; model?: string; maxTokens?: number },
): Promise<string> {
  const message = await client().messages.create({
    model: opts.model ?? agentModel(),
    max_tokens: opts.maxTokens ?? 700,
    system: opts.system,
    messages: [{ role: "user", content: prompt }],
  });
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
