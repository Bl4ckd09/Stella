/**
 * Persistent observability — read API.
 *
 *   GET /api/agents/history            → list recent runs (summaries)
 *   GET /api/agents/history?runId=...  → the events (audit trail) for one run
 *
 * Gated by the same auth as /hq (middleware). Read-only.
 */
import { NextResponse } from "next/server";
import { getRunEvents, listRuns, persistenceEnabled } from "@/lib/agents/persistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!persistenceEnabled()) {
    return NextResponse.json({ enabled: false, runs: [], events: [] });
  }
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId");
  if (runId) {
    const events = await getRunEvents(runId);
    return NextResponse.json({ enabled: true, runId, events });
  }
  const runs = await listRuns();
  return NextResponse.json({ enabled: true, runs });
}
