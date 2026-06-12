/**
 * POST /api/letter
 * Streams a council claim-letter draft (SSE). The £ figures are passed in from
 * the deterministic engine and reproduced verbatim — the LLM only writes prose.
 */
import { NextRequest } from "next/server";
import { streamChatResponse } from "@/lib/llm";
import { clampStr, clampArr } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const business = data.business ?? {};
  // Bound untrusted input so the prompt can't be inflated to drive up token cost.
  const findings = clampArr<{ headline: string; annual_value: number }>(business.findings, 12);
  const findingLines = findings
    .filter((f) => f.annual_value)
    .map((f) => `- ${clampStr(f.headline, 120)}: £${Math.round(Number(f.annual_value) || 0).toLocaleString("en-GB")}/yr`)
    .join("\n");

  const rv = Number(business.rateable_value ?? 0);
  const prompt =
    `Write a professional email under 120 words from the owner of a small business ` +
    `to their council claiming business rates relief. ` +
    `Address: ${clampStr(business.address, 200)}. UARN: ${clampStr(business.uarn, 40)}. ` +
    `Borough: ${clampStr(business.borough, 80)}. RV: £${Math.round(rv).toLocaleString("en-GB")}. ` +
    `Relief: ${findingLines}. Include UARN. End with [Your name].`;

  return streamChatResponse(prompt);
}
