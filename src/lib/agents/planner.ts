/**
 * Qwen-native planner — Ada chooses the next action via native function
 * calling instead of a fixed priority order.
 *
 * Safety shape: the LLM picks ONLY among candidates that planTick has already
 * validated (consent gates, approval gates, WIP limits all applied upstream).
 * A structurally invalid or failed choice returns null and the deterministic
 * priority order stands — the loop never depends on the model.
 */
import { AGENTS } from "./roster";
import { fastTier } from "../llm";
import { gbp } from "./format";
import type { ActionType, Deal } from "./types";

export interface PlanCandidate {
  deal: Deal;
  action: ActionType;
  score: number;
}

export interface PlannerChoice {
  index: number;
  rationale: string;
}

export function plannerAvailable(): boolean {
  return (
    process.env.STELLA_QWEN_PLANNER !== "false" &&
    fastTier().provider === "openai" &&
    Boolean(process.env.LLM_BASE_URL && process.env.LLM_API_KEY)
  );
}

const CHOOSE_TOOL = {
  type: "function",
  function: {
    name: "choose_action",
    description:
      "Choose which pending action the workforce should take this tick, by index from the numbered candidate list.",
    parameters: {
      type: "object",
      properties: {
        index: { type: "integer", description: "0-based index of the chosen candidate" },
        rationale: {
          type: "string",
          description: "One sentence explaining the choice, citing recalled experience when relevant",
        },
      },
      required: ["index", "rationale"],
    },
  },
};

/**
 * Ask Ada (fast tier, native tool call) to pick a candidate. Returns null on
 * any failure, timeout, or out-of-range answer — callers fall back to the
 * deterministic order.
 */
export async function choosePlan(
  candidates: PlanCandidate[],
  recall: string | null,
): Promise<PlannerChoice | null> {
  if (!plannerAvailable() || candidates.length < 2) return null;
  const menu = candidates
    .map(
      (c, i) =>
        `${i}. [${c.action}] ${c.deal.business.name} — ${c.deal.business.sector}, ${c.deal.business.borough}; ` +
        `stage ${c.deal.stage}; est ${gbp(c.deal.money.estAnnualSaving)}/yr; priority ${c.score}`,
    )
    .join("\n");
  const prompt = [
    "Pick the single best next action for the business this tick.",
    recall ? `\n${recall}` : "",
    "\nCandidates (pre-vetted by compliance and approval gates):",
    menu,
    "\nPriorities favour finishing casework over starting new work, but recalled experience may justify a different order. Call choose_action.",
  ].join("\n");

  try {
    const res = await fetch(`${(process.env.LLM_BASE_URL ?? "").replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.LLM_API_KEY}` },
      body: JSON.stringify({
        model: fastTier().model,
        max_tokens: 200,
        enable_thinking: false,
        messages: [
          { role: "system", content: AGENTS.orchestrator.system },
          { role: "user", content: prompt },
        ],
        tools: [CHOOSE_TOOL],
        tool_choice: { type: "function", function: { name: "choose_action" } },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const call = json?.choices?.[0]?.message?.tool_calls?.[0];
    if (call?.function?.name !== "choose_action") return null;
    const args = JSON.parse(call.function.arguments);
    const index = args?.index;
    if (!Number.isInteger(index) || index < 0 || index >= candidates.length) return null;
    return { index, rationale: String(args?.rationale ?? "").slice(0, 300) };
  } catch {
    return null;
  }
}
