/**
 * POST /api/voice-lookup  — ElevenLabs Conversational AI "server tool" webhook.
 *
 * The phone caller says their business name (and optionally a postcode). The
 * agent calls this tool; we run the SAME deterministic engine the web app uses
 * and return a concise, spoken-friendly summary. All £ figures are computed
 * here — the voice LLM must read them verbatim and never invent numbers.
 *
 * Auth: expects header `X-Tool-Secret: <VOICE_TOOL_SECRET>` (configured as a
 * secret header on the ElevenLabs tool).
 */
import { NextRequest, NextResponse } from "next/server";
import { run, runByName, isPostcode, type BusinessResult } from "@/lib/lookup";
import { bizProfile } from "@/lib/bizProfile";
import { boroughContact } from "@/lib/db";
import { logLookup } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

function spokenSummary(biz: BusinessResult, council: { phone?: string | null; email?: string | null } | null): string {
  const annual = biz.totals.total_annual_savings;
  const back = biz.totals.total_backdated;
  if (annual <= 0) {
    return (
      `I found your property at ${biz.address}, ${biz.postcode}, in ${biz.borough}. ` +
      `Its rateable value is ${gbp(biz.rateable_value)}. Based on that, it does not currently ` +
      `qualify for Small Business Rate Relief, but you may be able to appeal the valuation. ` +
      `Would you like me to explain how?`
    );
  }
  const reliefHeadline = biz.findings.find((f) => f.annual_value > 0)?.headline ?? "Small Business Rate Relief";
  let summary =
    `Good news. I found your property at ${biz.address}, ${biz.postcode}, in ${biz.borough}, ` +
    `with a rateable value of ${gbp(biz.rateable_value)}. ` +
    `You qualify for ${reliefHeadline}, worth about ${gbp(annual)} per year. ` +
    `If it has been unclaimed since April 2023, the backdated amount could be around ${gbp(back)}. ` +
    `This relief is not applied automatically — you have to claim it from your council. `;
  if (council?.phone) summary += `Your council's business rates team is on ${council.phone}. `;
  summary += `Would you like me to text you a ready-to-send claim letter?`;
  return summary;
}

export async function POST(req: NextRequest) {
  const secret = process.env.VOICE_TOOL_SECRET;
  if (secret && req.headers.get("x-tool-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await req.json().catch(() => ({}));
  // ElevenLabs sends the tool parameters at the top level.
  const businessName = String(data.business_name ?? data.name ?? data.query ?? "").trim();
  const postcode = String(data.postcode ?? "").trim();

  if (!businessName && !postcode) {
    return NextResponse.json({
      found: false,
      spoken_summary: "I didn't catch a business name. Could you say the name of your business again?",
    });
  }

  let biz: BusinessResult | undefined;
  let council: Awaited<ReturnType<typeof boroughContact>> = null;

  if (businessName && postcode) {
    const profile = await bizProfile({ name: businessName, postcode });
    if (profile.step === "analysis") {
      biz = profile.property;
      council = profile.council;
    } else if (profile.step === "pick_property") {
      // Pick the best-savings candidate for a smoother voice flow.
      biz = profile.properties[0];
      council = await boroughContact((biz?.borough ?? "").toLowerCase());
    }
  } else {
    const result = postcode && isPostcode(postcode)
      ? await run(postcode)
      : await runByName(businessName);
    biz = result.businesses[0];
    if (biz) council = await boroughContact((biz.borough ?? "").toLowerCase());
  }

  if (!biz) {
    logLookup({ channel: "phone", query: businessName, postcode });
    return NextResponse.json({
      found: false,
      spoken_summary:
        `I couldn't find a business rates record for "${businessName}". ` +
        `It might be registered under a slightly different name. ` +
        `Could you spell the business name, or tell me the postcode of the premises?`,
    });
  }

  logLookup({ channel: "phone", query: businessName, postcode: biz.postcode, uarn: biz.uarn, result: biz });

  // Structured fields (for the agent to optionally use) + the spoken summary.
  return NextResponse.json({
    found: true,
    business_name: businessName || biz.name,
    address: biz.address,
    postcode: biz.postcode,
    borough: biz.borough,
    rateable_value: biz.rateable_value,
    annual_relief: biz.totals.total_annual_savings,
    backdated_relief: biz.totals.total_backdated,
    reliefs: biz.findings.filter((f) => f.annual_value > 0).map((f) => f.headline),
    council_phone: council?.phone ?? null,
    council_email: council?.email ?? null,
    council_apply_url: council?.apply_url ?? null,
    spoken_summary: spokenSummary(biz, council),
  });
}
