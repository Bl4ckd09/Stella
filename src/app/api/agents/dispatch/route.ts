/**
 * Parallel outbound campaign endpoint.
 *
 * Fires outbound contact (voice / WhatsApp / email) to every qualified +
 * consented owner concurrently, and holds the non-consented ones. Sends are
 * sandbox-simulated unless STELLA_LIVE_OUTBOUND=true.
 *
 *   POST { state, useLLM, concurrency } → { state, events, dispatched, skipped }
 */
import { NextResponse } from "next/server";
import { dispatchOutbound, hasWork } from "@/lib/agents/orchestrator";
import { persistRun } from "@/lib/agents/persistence";
import type { BusinessState } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  let body: { state?: BusinessState; useLLM?: boolean; concurrency?: number; runId?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.state) return NextResponse.json({ error: "missing_state" }, { status: 400 });

  const res = await dispatchOutbound(body.state, { useLLM: body.useLLM ?? false, concurrency: body.concurrency });
  if (body.runId) await persistRun(body.runId, res.state, res.events, body.label);
  return NextResponse.json({ ...res, hasWork: hasWork(res.state) });
}
