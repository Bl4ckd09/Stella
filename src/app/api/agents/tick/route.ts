/**
 * Stella Autonomous — the loop endpoint.
 *
 * The Mission Control console holds the business state and calls this once per
 * "tick" to advance the company by one world-step. The server runs the
 * orchestrator (deterministic engine + compliance guard + LLM reasoning) and
 * returns the next state plus the events produced. Stateless: nothing is
 * persisted, so the whole run is replayable from the client's state.
 *
 *   POST {}                         → fresh state (no tick)
 *   POST { state, useLLM, steps }   → advance `steps` ticks (default 1)
 */
import { NextResponse } from "next/server";
import { initState, tick, hasWork } from "@/lib/agents/orchestrator";
import type { AgentEvent, AutonomyLevel, BusinessState } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    state?: BusinessState;
    useLLM?: boolean;
    steps?: number;
    autonomy?: AutonomyLevel;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // No state yet → hand back a fresh company.
  if (!body.state) {
    const state = initState(body.autonomy ?? "assisted");
    return NextResponse.json({ state, events: [], hasWork: hasWork(state) });
  }

  const steps = Math.min(Math.max(1, body.steps ?? 1), 10);
  let state = body.state;
  const events: AgentEvent[] = [];
  for (let i = 0; i < steps; i++) {
    const res = await tick(state, { useLLM: body.useLLM ?? false });
    state = res.state;
    events.push(...res.events);
    if (!hasWork(state)) break;
  }

  return NextResponse.json({ state, events, hasWork: hasWork(state) });
}
