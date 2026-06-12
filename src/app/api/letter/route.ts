/**
 * POST /api/letter
 * Streams a council claim-letter draft (SSE). The £ figures are passed in from
 * the deterministic engine and reproduced verbatim — the LLM only writes prose.
 */
import { NextRequest } from "next/server";
import { streamChatResponse } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const business = data.business ?? {};
  const findings: { headline: string; annual_value: number }[] = business.findings ?? [];
  const findingLines = findings
    .filter((f) => f.annual_value)
    .map((f) => `- ${f.headline}: £${Math.round(f.annual_value).toLocaleString("en-GB")}/yr`)
    .join("\n");

  const rv = Number(business.rateable_value ?? 0);
  const prompt =
    `Write a professional email under 120 words from the owner of a small business ` +
    `to their council claiming business rates relief. ` +
    `Address: ${business.address}. UARN: ${business.uarn}. ` +
    `Borough: ${business.borough}. RV: £${Math.round(rv).toLocaleString("en-GB")}. ` +
    `Relief: ${findingLines}. Include UARN. End with [Your name].`;

  return streamChatResponse(prompt);
}
