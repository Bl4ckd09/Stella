/**
 * Human-in-the-loop approval endpoint.
 *
 * High-risk agent actions (e.g. submitting an application to a council on a
 * customer's behalf) wait in the approval queue until a human decides. This
 * applies that decision to the state the console holds.
 *
 *   POST { state, approvalId, decision: "approved" | "rejected" } → { state }
 */
import { NextResponse } from "next/server";
import { decideApproval } from "@/lib/agents/orchestrator";
import type { BusinessState } from "@/lib/agents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { state?: BusinessState; approvalId?: string; decision?: "approved" | "rejected" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  if (!body.state || !body.approvalId || !body.decision) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }
  const state = decideApproval(body.state, body.approvalId, body.decision);
  return NextResponse.json({ state });
}
