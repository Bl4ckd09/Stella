/**
 * POST /api/grant-application
 * Streams a complete 4-section grant application package (SSE), tailored to the
 * business profile and a specific matched grant. Numbers are facts from the
 * engine; the LLM writes only the narrative.
 */
import { NextRequest } from "next/server";
import { streamChatResponse } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const grant = data.grant ?? {};
  const biz = data.business ?? {};

  const reasons: string[] = grant.match_reasons ?? [];
  const blockers: string[] = grant.blockers ?? [];
  const sicStr = (biz.sic_codes ?? []).slice(0, 2).join(", ") || "not specified";
  const age = biz.company_age_years;
  const ageStr = age ? `${Math.round(age)} years old` : "age unknown";
  const rv = Number(biz.rateable_value ?? 0);

  const prompt = `You are helping ${biz.name ?? "this business"} apply for ${grant.name}.

BUSINESS PROFILE:
- Name: ${biz.name ?? "Unknown"}
- Sector: ${biz.sector ?? ""} | Borough: ${biz.borough ?? ""}
- Company age: ${ageStr} | Rateable value: £${Math.round(rv).toLocaleString("en-GB")}
- SIC codes: ${sicStr}

GRANT:
- Name: ${grant.name}
- Funder: ${grant.funder}
- Value: ${grant.value}
- Apply at: ${grant.url}
- Deadline: ${grant.deadline}

WHY THIS BUSINESS IS ELIGIBLE:
${reasons.map((r) => `- ${r}`).join("\n")}
${blockers.map((b) => `- BLOCKER: ${b}`).join("\n")}

Write a complete grant application package with these 4 sections, each clearly labelled:

**SECTION 1 — WHY YOU QUALIFY (3 bullet points, specific to this business)**
**SECTION 2 — APPLICATION EMAIL (under 120 words, professional, ready to send)**
**SECTION 3 — DOCUMENTS CHECKLIST (5 items you need to gather)**
**SECTION 4 — STEP-BY-STEP HOW TO APPLY (5 numbered steps with URLs)**

Be specific. Use the actual business name and figures. No generic filler.`;

  return streamChatResponse(prompt);
}
