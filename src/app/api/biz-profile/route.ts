/**
 * POST /api/biz-profile
 * My Business: { name, postcode, sector?, uarn? } → company verification +
 * VOA property match + relief analysis + grants. Returns step "analysis",
 * "pick_property", or an error.
 */
import { NextRequest, NextResponse } from "next/server";
import { bizProfile } from "@/lib/bizProfile";
import { logLookup } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const result = await bizProfile({
    name: String(data.name ?? ""),
    postcode: String(data.postcode ?? ""),
    sector: data.sector ? String(data.sector) : null,
    uarn: data.uarn ? String(data.uarn) : "",
  });

  if (result.step === "error") {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  logLookup({
    channel: "web",
    query: String(data.name ?? ""),
    postcode: String(data.postcode ?? ""),
    uarn: result.step === "analysis" ? result.property.uarn : undefined,
    result,
  });
  return NextResponse.json(result);
}
