/**
 * POST /api/mistral-voice — Mistral Voxtral web voice turn.
 *
 * Accepts either browser-recorded WAV audio or direct text, runs Stella's
 * Mistral tool-calling voice agent, and returns text plus best-effort MP3 TTS.
 * The ElevenLabs webhook and Twilio phone routes remain separate.
 */
import { NextRequest, NextResponse } from "next/server";
import { agentReply, transcribe, tts, type ChatMsg } from "@/lib/mistralVoice";

export const runtime = "nodejs";
export const maxDuration = 60;

interface VoiceTurnBody {
  audio_base64?: unknown;
  audio_format?: unknown;
  text?: unknown;
  history?: unknown;
  phone?: unknown;
}

function cleanHistory(value: unknown): ChatMsg[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((m): ChatMsg[] => {
    if (!m || typeof m !== "object") return [];
    const role = (m as { role?: unknown }).role;
    const content = (m as { content?: unknown }).content;
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return [];
    return [{ role, content }];
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.MISTRAL_API_KEY) {
    return NextResponse.json({ error: "mistral_not_configured" }, { status: 503 });
  }

  const totalStarted = Date.now();
  const data = await req.json().catch(() => ({})) as VoiceTurnBody;
  const text = typeof data.text === "string" ? data.text.trim() : "";
  const audioBase64 = typeof data.audio_base64 === "string" ? data.audio_base64 : "";
  const audioFormat = typeof data.audio_format === "string" ? data.audio_format : "audio/wav";
  const phone = typeof data.phone === "string" ? data.phone.trim() : "";

  let userText = text;
  let sttMs = 0;
  if (!userText && audioBase64) {
    const stt = await transcribe(audioBase64, audioFormat);
    userText = stt.text;
    sttMs = stt.ms;
  }

  if (!userText) {
    return NextResponse.json({ error: "missing_input" }, { status: 400 });
  }

  const history = cleanHistory(data.history);
  const contextualHistory: ChatMsg[] = phone
    ? [{ role: "system", content: `Caller phone number: ${phone}` }, ...history]
    : history;
  const reply = await agentReply(contextualHistory, userText);
  const speech = await tts(reply.text);
  const totalMs = Date.now() - totalStarted;

  console.log(`[mistral-voice] stt=${sttMs}ms chat=${reply.ms}ms tts=${speech.ms}ms total=${totalMs}ms`);

  return NextResponse.json({
    user_text: userText,
    reply_text: reply.text,
    audio_base64: speech.audioBase64,
    audio_format: "mp3",
    history: [...history, { role: "user", content: userText }, { role: "assistant", content: reply.text }],
    timings: {
      stt_ms: sttMs,
      chat_ms: reply.ms,
      tts_ms: speech.ms,
      total_ms: totalMs,
    },
  });
}
