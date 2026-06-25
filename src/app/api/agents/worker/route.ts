/**
 * Worker control — turn the 24/7 unattended run on/off and read its status.
 * Operator-only (gated by the HQ Basic-auth middleware).
 *
 *   GET  /api/agents/worker                      → status
 *   POST /api/agents/worker { enabled, useLLM }  → update, returns status
 */
import { NextResponse } from "next/server";
import { getWorkerStatus, setWorker } from "@/lib/agents/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: await getWorkerStatus() });
}

export async function POST(req: Request) {
  let body: { enabled?: boolean; useLLM?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  await setWorker(body);
  return NextResponse.json({ status: await getWorkerStatus() });
}
