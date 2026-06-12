/**
 * POST /api/lookup
 * Street Scanner / quick lookup: postcode OR business name → relief findings.
 * Mirrors the original Flask /api/lookup, including the optional sector override.
 */
import { NextRequest, NextResponse } from "next/server";
import { run, runByName, isPostcode } from "@/lib/lookup";
import { assess, grossBill, totals, type Business } from "@/lib/engines/relief";
import { logLookup } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const query = String(data.query ?? "").trim();
  const sectorOverride = String(data.sector ?? "").trim() || null;

  if (!query) {
    return NextResponse.json({ error: "Please enter a postcode or business name" }, { status: 400 });
  }

  const result = isPostcode(query) ? await run(query.toUpperCase()) : await runByName(query);

  // Apply sector override to the first business if requested.
  if (sectorOverride && result.businesses.length) {
    const b = result.businesses[0];
    const rv = b.rateable_value;
    const biz: Business = {
      name: b.name, rateable_value: rv, borough: b.borough, sector: sectorOverride,
      uarn: b.uarn, address: b.address, postcode: b.postcode,
    };
    const findings = assess(biz);
    b.sector = sectorOverride;
    b.gross_annual_bill = Math.round(grossBill(rv, sectorOverride) * 100) / 100;
    b.findings = findings;
    b.totals = totals(findings);
  }

  logLookup({ channel: "web", query, result });
  return NextResponse.json(result);
}
