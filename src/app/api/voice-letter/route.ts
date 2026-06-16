/**
 * POST /api/voice-letter — ElevenLabs Conversational AI "server tool" webhook.
 *
 * After a lookup, the caller asks Stella to send the claim letter. The agent
 * calls this tool with the business name + postcode; the caller's number is
 * supplied automatically from the `system__caller_id` dynamic variable. We
 * re-run the SAME deterministic engine to get exact figures, have the LLM write
 * ONLY the prose, and text the finished letter to the caller via Twilio SMS.
 *
 * LLM BOUNDARY: every £ figure is injected from the engine — numbers never
 * touch the AI, identical to the web /api/letter route.
 *
 * Auth: header `X-Tool-Secret: <VOICE_TOOL_SECRET>`.
 */
import { NextRequest, NextResponse } from "next/server";
import { bizProfile } from "@/lib/bizProfile";
import { boroughContact, logLookup } from "@/lib/db";
import { chat } from "@/lib/llm";
import { sendSms, normalizePhone } from "@/lib/sms";
import type { BusinessResult } from "@/lib/lookup";

export const runtime = "nodejs";
export const maxDuration = 30;

function gbp(n: number): string {
  return `£${Math.round(n).toLocaleString("en-GB")}`;
}

type Council = Awaited<ReturnType<typeof boroughContact>>;

async function buildLetter(biz: BusinessResult, council: Council): Promise<string> {
  const findingLines = biz.findings
    .filter((f) => f.annual_value > 0)
    .map((f) => `- ${f.headline}: ${gbp(f.annual_value)} per year`)
    .join("\n");
  const prompt =
    `Write a professional, ready-to-send email UNDER 110 WORDS from the owner of a ` +
    `small business to their local council claiming business rates relief. ` +
    `Plain text only — no markdown, no subject line. ` +
    `Start directly with "Dear Business Rates Team," and end with "[Your name]". ` +
    `Premises address: ${biz.address}. UARN: ${biz.uarn}. Borough: ${biz.borough}. ` +
    `Rateable value: ${gbp(biz.rateable_value)}. ` +
    `Relief being claimed:\n${findingLines}\n` +
    `Reproduce every figure exactly as written above and include the UARN.`;
  return chat(prompt);
}

export async function POST(req: NextRequest) {
  const secret = process.env.VOICE_TOOL_SECRET;
  if (secret && req.headers.get("x-tool-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const data = await req.json().catch(() => ({}));
  const businessName = String(data.business_name ?? data.name ?? "").trim();
  const postcode = String(data.postcode ?? "").trim();
  const toPhone = normalizePhone(data.to_phone ?? data.caller_id ?? "");

  if (!businessName || !postcode) {
    return NextResponse.json({
      sent: false,
      spoken_summary:
        "Before I can send the letter I need your business name and the postcode of the premises. Could you tell me those?",
    });
  }
  if (!toPhone) {
    return NextResponse.json({
      sent: false,
      spoken_summary:
        "I couldn't read the number you're calling from, so I'm not able to text the letter. You can also generate it on our website.",
    });
  }

  // Deterministic engine → exact figures (re-run, do NOT trust any AI-supplied number).
  const profile = await bizProfile({ name: businessName, postcode });
  let biz: BusinessResult | undefined;
  let council: Council = null;
  if (profile.step === "analysis") {
    biz = profile.property;
    council = profile.council;
  } else if (profile.step === "pick_property") {
    biz = profile.properties[0];
    council = await boroughContact((biz?.borough ?? "").toLowerCase());
  }

  if (!biz) {
    return NextResponse.json({
      sent: false,
      spoken_summary: `I couldn't pull up the figures for "${businessName}" to put in a letter. Could you confirm the business name and postcode?`,
    });
  }
  if (biz.totals.total_annual_savings <= 0) {
    return NextResponse.json({
      sent: false,
      spoken_summary:
        "That property doesn't currently qualify for relief, so there isn't a claim letter to send. You may be able to appeal the valuation instead — would you like me to explain how?",
    });
  }

  const letter = await buildLetter(biz, council);
  const dest = council?.email ? `email it to ${council.email}` : "email it to your council";
  const sms =
    `Stella — your business rates claim letter for ${biz.address}, ${biz.postcode}. ` +
    `Add your name and ${dest}:\n\n${letter}`;

  const result = await sendSms(toPhone, sms);
  logLookup({
    channel: "phone",
    query: businessName,
    postcode: biz.postcode,
    uarn: biz.uarn,
    result: { action: "letter_sms", ok: result.ok, code: result.code ?? null },
  });

  if (!result.ok) {
    // Twilio trial accounts can only text *verified* numbers (error code 21608).
    const trial = result.code === 21608;
    return NextResponse.json({
      sent: false,
      spoken_summary: trial
        ? "I've drafted your claim letter, but this phone line isn't yet able to text this number. You can get the exact same letter on our website in the meantime."
        : "I drafted your letter but hit a problem texting it just now. Please try our website, or call back shortly and I'll try again.",
    });
  }

  return NextResponse.json({
    sent: true,
    to: toPhone,
    council_email: council?.email ?? null,
    spoken_summary:
      `Done — I've just texted your ready-to-send claim letter to the number you're calling from. ` +
      `Copy it into an email to ${council?.email ?? "your council"}, add your name, and send it. Anything else?`,
  });
}
