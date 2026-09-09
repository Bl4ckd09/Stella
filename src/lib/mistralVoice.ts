/**
 * Mistral-native web voice helpers.
 *
 * The browser records WAV audio, this module handles Voxtral STT, a
 * tool-calling Stella agent, and best-effort Voxtral TTS. Monetary figures come
 * only from Stella's deterministic engines and are passed back to the model as
 * authoritative tool results.
 */
import { run, runByName, isPostcode, type BusinessResult } from "@/lib/lookup";
import { bizProfile } from "@/lib/bizProfile";
import { boroughContact, logLookup } from "@/lib/db";
import { chat } from "@/lib/llm";
import { sendSms, normalizePhone } from "@/lib/sms";

const MISTRAL_BASE = "https://api.mistral.ai/v1";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

type Council = Awaited<ReturnType<typeof boroughContact>>;

interface MistralToolCall {
  id: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface MistralMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: MistralToolCall[];
}

interface MistralChatResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: MistralToolCall[];
    };
  }>;
}

function apiKey(): string {
  const key = process.env.MISTRAL_API_KEY;
  if (!key) throw new Error("MISTRAL_API_KEY is not set");
  return key;
}

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${apiKey()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function msSince(started: number): number {
  return Date.now() - started;
}

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

function stripDataUrl(audioBase64: string): string {
  const comma = audioBase64.indexOf(",");
  return comma >= 0 ? audioBase64.slice(comma + 1) : audioBase64;
}

/**
 * Transcribe base64 audio with Mistral Voxtral.
 */
export async function transcribe(audioBase64: string, mimeType: string): Promise<{ text: string; ms: number }> {
  const started = Date.now();
  const bytes = Uint8Array.from(Buffer.from(stripDataUrl(audioBase64), "base64"));
  const body = new FormData();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  body.append("file", new Blob([buffer], { type: mimeType }), "audio.wav");
  body.append("model", "voxtral-mini-latest");

  const res = await fetch(`${MISTRAL_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: headers(false),
    body,
  });
  if (!res.ok) throw new Error(`mistral stt http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { text?: unknown; transcription?: unknown };
  return { text: String(json.text ?? json.transcription ?? "").trim(), ms: msSince(started) };
}

async function lookupBusiness(args: {
  business_name?: unknown;
  name?: unknown;
  query?: unknown;
  postcode?: unknown;
}): Promise<Record<string, unknown>> {
  const businessName = String(args.business_name ?? args.name ?? args.query ?? "").trim();
  const postcode = String(args.postcode ?? "").trim();

  if (!businessName && !postcode) {
    return {
      found: false,
      spoken_summary: "I didn't catch a business name. Could you say the name of your business again?",
    };
  }

  let biz: BusinessResult | undefined;
  let council: Council = null;

  if (businessName && postcode) {
    const profile = await bizProfile({ name: businessName, postcode });
    if (profile.step === "analysis") {
      biz = profile.property;
      council = profile.council;
    } else if (profile.step === "pick_property") {
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
    logLookup({ channel: "web-voice", query: businessName, postcode });
    return {
      found: false,
      spoken_summary:
        `I couldn't find a business rates record for "${businessName}". ` +
        `It might be registered under a slightly different name. ` +
        `Could you spell the business name, or tell me the postcode of the premises?`,
    };
  }

  logLookup({ channel: "web-voice", query: businessName, postcode: biz.postcode, uarn: biz.uarn, result: biz });

  return {
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
  };
}

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

async function sendClaimLetter(
  args: { business_name?: unknown; name?: unknown; postcode?: unknown; to_phone?: unknown; caller_id?: unknown },
  defaultPhone: string,
): Promise<Record<string, unknown>> {
  const businessName = String(args.business_name ?? args.name ?? "").trim();
  const postcode = String(args.postcode ?? "").trim();
  const toPhone = normalizePhone(args.to_phone ?? args.caller_id ?? defaultPhone);

  if (!businessName || !postcode) {
    return {
      sent: false,
      spoken_summary:
        "Before I can send the letter I need your business name and the postcode of the premises. Could you tell me those?",
    };
  }
  if (!toPhone) {
    return {
      sent: false,
      spoken_summary:
        "I couldn't read your phone number, so I'm not able to text the letter. You can also generate it on our website.",
    };
  }

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
    return {
      sent: false,
      spoken_summary: `I couldn't pull up the figures for "${businessName}" to put in a letter. Could you confirm the business name and postcode?`,
    };
  }
  if (biz.totals.total_annual_savings <= 0) {
    return {
      sent: false,
      spoken_summary:
        "That property doesn't currently qualify for relief, so there isn't a claim letter to send. You may be able to appeal the valuation instead — would you like me to explain how?",
    };
  }

  const letter = await buildLetter(biz, council);
  const dest = council?.email ? `email it to ${council.email}` : "email it to your council";
  const sms =
    `Stella — your business rates claim letter for ${biz.address}, ${biz.postcode}. ` +
    `Add your name and ${dest}:\n\n${letter}`;

  const result = await sendSms(toPhone, sms);
  logLookup({
    channel: "web-voice",
    query: businessName,
    postcode: biz.postcode,
    uarn: biz.uarn,
    result: { action: "letter_sms", ok: result.ok, code: result.code ?? null },
  });

  if (!result.ok) {
    const trial = result.code === 21608;
    return {
      sent: false,
      spoken_summary: trial
        ? "I've drafted your claim letter, but this phone line isn't yet able to text this number. You can get the exact same letter on our website in the meantime."
        : "I drafted your letter but hit a problem texting it just now. Please try our website, or call back shortly and I'll try again.",
    };
  }

  return {
    sent: true,
    to: toPhone,
    council_email: council?.email ?? null,
    spoken_summary:
      `Done — I've just texted your ready-to-send claim letter to your phone. ` +
      `Copy it into an email to ${council?.email ?? "your council"}, add your name, and send it. Anything else?`,
  };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function defaultPhoneFrom(history: ChatMsg[]): string {
  const ctx = history
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const match = ctx.match(/Caller phone number:\s*([^\n]+)/i);
  return normalizePhone(match?.[1] ?? "");
}

async function executeTool(call: MistralToolCall, defaultPhone: string): Promise<Record<string, unknown>> {
  const name = call.function?.name ?? "";
  const args = parseArgs(call.function?.arguments);
  if (name === "lookup_business") return lookupBusiness(args);
  if (name === "send_claim_letter") return sendClaimLetter(args, defaultPhone);
  return { error: `unknown_tool: ${name}` };
}

const tools = [
  {
    type: "function",
    function: {
      name: "lookup_business",
      description: "Look up UK business-rates relief for a business name and/or postcode.",
      parameters: {
        type: "object",
        properties: {
          business_name: { type: "string" },
          postcode: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_claim_letter",
      description: "Text a ready-to-send business-rates claim letter to the caller.",
      parameters: {
        type: "object",
        properties: {
          business_name: { type: "string" },
          postcode: { type: "string" },
          to_phone: { type: "string" },
        },
        required: ["business_name", "postcode"],
      },
    },
  },
];

const SYSTEM_PROMPT =
  "You are Stella, a friendly UK business-rates voice assistant. " +
  "Speak in concise, natural sentences for a phone-style conversation. " +
  "You MUST read all £ figures verbatim from tool results and never invent numbers. " +
  "Use lookup_business before giving any money figure. " +
  "After a successful lookup with savings, offer to text a ready-to-send claim letter. " +
  "If asked to text the letter and you know the caller's phone number, call send_claim_letter.";

async function chatCompletion(messages: MistralMessage[]): Promise<MistralChatResponse> {
  const res = await fetch(`${MISTRAL_BASE}/chat/completions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: "mistral-small-latest",
      messages,
      tools,
      tool_choice: "auto",
    }),
  });
  if (!res.ok) throw new Error(`mistral chat http ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<MistralChatResponse>;
}

/**
 * Run the Stella tool-calling agent with up to three tool iterations.
 */
export async function agentReply(history: ChatMsg[], userText: string): Promise<{ text: string; ms: number }> {
  const started = Date.now();
  const systemContext = history
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n");
  const defaultPhone = defaultPhoneFrom(history);
  const messages: MistralMessage[] = [
    { role: "system", content: systemContext ? `${SYSTEM_PROMPT}\n\nContext:\n${systemContext}` : SYSTEM_PROMPT },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m): MistralMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: userText },
  ];

  for (let i = 0; i < 3; i += 1) {
    const json = await chatCompletion(messages);
    const message = json.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    if (!toolCalls.length) {
      return { text: String(message?.content ?? "").trim(), ms: msSince(started) };
    }

    messages.push({
      role: "assistant",
      content: message?.content ?? null,
      tool_calls: toolCalls,
    });
    for (const call of toolCalls) {
      const result = await executeTool(call, defaultPhone);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    text: "I have the lookup result, but I need a moment before I can answer clearly. Please try again.",
    ms: msSince(started),
  };
}

async function ttsRequest(text: string, includeVoice: boolean): Promise<string | null> {
  const voiceId = process.env.MISTRAL_TTS_VOICE_ID;
  const body: Record<string, string> = {
    model: "voxtral-mini-tts-2603",
    input: text,
    response_format: "mp3",
  };
  if (includeVoice && voiceId) body.voice_id = voiceId;

  const res = await fetch(`${MISTRAL_BASE}/audio/speech`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const json = (await res.json().catch(() => ({}))) as { audio_data?: unknown };
  const audio = typeof json.audio_data === "string" ? json.audio_data : "";
  return audio || null;
}

/**
 * Synthesize speech with Mistral Voxtral. TTS is best-effort: failures return a
 * null audio payload so the browser can display the text reply.
 */
export async function tts(text: string): Promise<{ audioBase64: string | null; ms: number }> {
  const started = Date.now();
  const hasVoice = Boolean(process.env.MISTRAL_TTS_VOICE_ID);
  try {
    const first = await ttsRequest(text, hasVoice);
    if (first) return { audioBase64: first, ms: msSince(started) };
  } catch {
    /* retry without a saved voice */
  }

  try {
    const second = await ttsRequest(text, false);
    return { audioBase64: second, ms: msSince(started) };
  } catch {
    return { audioBase64: null, ms: msSince(started) };
  }
}
