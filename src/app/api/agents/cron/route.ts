/**
 * Vercel Cron entrypoint for the 24/7 unattended worker.
 *
 * Scheduled in vercel.json. Vercel sends `Authorization: Bearer $CRON_SECRET`,
 * which we verify here (this route is exempt from the HQ Basic-auth gate in
 * middleware, so it must guard itself). Each call advances the live run a few
 * steps and persists everything.
 */
import { NextResponse } from "next/server";
import { workerTick } from "@/lib/agents/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_not_configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await workerTick();
  return NextResponse.json(result);
}
