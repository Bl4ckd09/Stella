/**
 * POST /api/grants — standalone grant matcher (deterministic).
 */
import { NextRequest, NextResponse } from "next/server";
import { matchGrants } from "@/lib/engines/grants";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const grants = matchGrants({
    sector: data.sector ?? "other",
    sic_codes: data.sic_codes ?? [],
    borough: data.borough ?? "",
    rateable_value: Number(data.rateable_value ?? 0),
    company_age_years: data.company_age_years ?? null,
    company_type: data.company_type ?? "",
    company_name: data.company_name ?? "",
  });
  return NextResponse.json({ grants });
}
