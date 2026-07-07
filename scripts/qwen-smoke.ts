/**
 * Live end-to-end smoke: run the autonomous loop against Qwen Cloud with
 * useLLM=true and confirm (1) agents produce LLM-written reasoning, (2) the
 * Qwen planner fires, (3) experience memory accumulates + is recalled, and
 * (4) every artifact still passes the compliance guard.
 *
 * Run: node --env-file=.env.local node_modules/.bin/tsx scripts/qwen-smoke.ts
 */
import { initState, tick, hasWork, decideApproval, dispatchOutbound, outreachReady } from "../src/lib/agents/orchestrator";
import { plannerAvailable } from "../src/lib/agents/planner";
import { memoryRecallAvailable } from "../src/lib/agents/memory";
import { llmStatus } from "../src/lib/llm";
import type { BusinessState } from "../src/lib/agents/types";

async function main() {
  console.log("LLM config:", JSON.stringify(llmStatus()));
  console.log("plannerAvailable:", plannerAvailable(), "| memoryRecallAvailable:", memoryRecallAvailable());

  let state: BusinessState = initState("assisted");
  let plannerEvents = 0;
  let llmReasoning = 0;
  let guard = 0;

  while (guard++ < 120 && hasWork(state)) {
    for (const a of state.approvals.filter((x) => x.decided === null)) state = decideApproval(state, a.id, "approved");
    const { toContact, toHold } = outreachReady(state);
    if (toContact + toHold > 0) {
      state = (await dispatchOutbound(state, { useLLM: true, simulateLatency: false })).state;
      continue;
    }
    const { state: next, events } = await tick(state, { useLLM: true });
    state = next;
    for (const e of events) {
      if (e.headline.startsWith("🧭")) { plannerEvents++; console.log("  PLANNER:", e.reasoning.slice(0, 120)); }
      if (e.reasoning && e.reasoning.length > 40 && !e.blocked) llmReasoning++;
    }
  }

  const artifacts = state.deals.flatMap((d) => d.artifacts);
  const allPass = artifacts.every((a) => a.review?.pass === true);
  console.log("\n── results ──");
  console.log("ticks:", state.tick, "| deals:", state.deals.length);
  console.log("LLM-written reasoning lines:", llmReasoning);
  console.log("planner overrides fired:", plannerEvents);
  console.log("memories accumulated:", (state.memories ?? []).length);
  console.log("artifacts:", artifacts.length, "| all compliance-pass:", allPass);
  console.log("revenue: £" + state.finances.revenue, "| customers:", state.finances.customers);
  console.log("\nsample artifact (first 300 chars):\n" + (artifacts[0]?.body.slice(0, 300) ?? "(none)"));
  if (!allPass) { console.error("COMPLIANCE FAILURE"); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
