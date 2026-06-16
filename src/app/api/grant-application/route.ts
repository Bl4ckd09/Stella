/**
 * POST /api/grant-application
 * Streams a complete 4-section grant application package (SSE), tailored to the
 * business profile and a specific matched grant. Numbers are facts from the
 * engine; the LLM writes only the narrative.
 */
import { NextRequest } from "next/server";
import { streamChatResponse } from "@/lib/llm";
import { clampStr, clampArr } from "@/lib/sanitize";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const data = await req.json().catch(() => ({}));
  const grant = data.grant ?? {};
  const biz = data.business ?? {};

  // Bound untrusted input to keep prompt (and token cost) in check.
  const reasons = clampArr<string>(grant.match_reasons, 12).map((r) => clampStr(r, 200));
  const blockers = clampArr<string>(grant.blockers, 8).map((b) => clampStr(b, 200));
  const sicStr = clampArr<string>(biz.sic_codes, 2).map((s) => clampStr(s, 80)).join(", ") || "not specified";
  const age = Number(biz.company_age_years);
  const ageStr = age ? `${Math.round(age)} years old` : "age unknown";
  const rv = Number(biz.rateable_value ?? 0);

  const prompt = `You are helping ${clampStr(biz.name, 120) || "this business"} apply for ${clampStr(grant.name, 120)}.

BUSINESS PROFILE:
- Name: ${clampStr(biz.name, 120) || "Unknown"}
- Sector: ${clampStr(biz.sector, 40)} | Borough: ${clampStr(biz.borough, 80)}
- Company age: ${ageStr} | Rateable value: £${Math.round(rv).toLocaleString("en-GB")}
- SIC codes: ${sicStr}

GRANT:
- Name: ${clampStr(grant.name, 120)}
- Funder: ${clampStr(grant.funder, 120)}
- Value: ${clampStr(grant.value, 120)}
- Apply at: ${clampStr(grant.url, 200)}
- Deadline: ${clampStr(grant.deadline, 80)}

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
