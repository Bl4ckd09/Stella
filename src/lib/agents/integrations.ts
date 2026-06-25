/**
 * Outbound channel adapters — how the workforce actually reaches owners.
 *
 * SAFE BY DEFAULT: every send is SIMULATED unless `STELLA_LIVE_OUTBOUND=true`
 * AND the relevant channel is configured. This lets the demo show parallel
 * outbound (voice calls + WhatsApp + email going out at once) with zero
 * telephony cost and zero risk of actually contacting anyone. Flip the flag and
 * drop in the hackathon-partner creds (ElevenLabs voice, Wassist WhatsApp,
 * Resend email) to go live.
 *
 * Outbound is only ever called for owners who CONSENTED (see the dispatcher's
 * consent gate) — the PRD bans cold outreach.
 */
import type { Artifact, Deal, OutboundChannel } from "./types";

export interface OutboundResult {
  ok: boolean;
  channel: OutboundChannel;
  ref: string;
  simulated: boolean;
  detail: string;
}

export function liveOutboundEnabled(): boolean {
  return process.env.STELLA_LIVE_OUTBOUND === "true";
}

/** Small deterministic "connecting" latency so parallel dispatch is observable. */
function connectLatencyMs(deal: Deal): number {
  let h = 0;
  for (const c of deal.id + deal.business.uarn) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 300 + (h % 600); // 300–900ms
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Live adapters (only run when explicitly enabled + configured) ────────────

async function liveVoice(deal: Deal): Promise<OutboundResult> {
  const key = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.ELEVENLABS_AGENT_ID;
  const phoneNumberId = process.env.ELEVENLABS_PHONE_NUMBER_ID;
  if (!key || !agentId || !phoneNumberId || !deal.business.phone) throw new Error("voice not configured");
  // ElevenLabs Conversational AI outbound call (via Twilio).
  const res = await fetch("https://api.elevenlabs.io/v1/convai/twilio/outbound-call", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: agentId,
      agent_phone_number_id: phoneNumberId,
      to_number: deal.business.phone,
    }),
  });
  if (!res.ok) throw new Error(`elevenlabs http ${res.status}`);
  const json = await res.json().catch(() => ({}));
  return { ok: true, channel: "voice", ref: String(json?.call_sid ?? "call"), simulated: false, detail: "outbound call placed" };
}

async function liveWhatsApp(deal: Deal, artifact: Artifact): Promise<OutboundResult> {
  const key = process.env.WASSIST_API_KEY;
  const url = process.env.WASSIST_API_URL; // partner-provided send endpoint
  if (!key || !url || !deal.business.phone) throw new Error("whatsapp not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ to: deal.business.phone, message: artifact.body }),
  });
  if (!res.ok) throw new Error(`wassist http ${res.status}`);
  return { ok: true, channel: "whatsapp", ref: "wa", simulated: false, detail: "WhatsApp message sent" };
}

async function liveEmail(deal: Deal, artifact: Artifact): Promise<OutboundResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) throw new Error("email not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: `${deal.business.contact} <owner+${deal.id}@example.com>`,
      subject: artifact.title,
      text: artifact.body,
    }),
  });
  if (!res.ok) throw new Error(`resend http ${res.status}`);
  const json = await res.json().catch(() => ({}));
  return { ok: true, channel: "email", ref: String(json?.id ?? "email"), simulated: false, detail: "email sent" };
}

// ── Simulation (default) ─────────────────────────────────────────────────────

async function simulate(deal: Deal, channel: OutboundChannel, withLatency: boolean): Promise<OutboundResult> {
  // Only the parallel campaign adds a "connecting" delay, so the concurrency is
  // observable (wall-clock ≈ slowest contact, not the sum). The per-tick loop
  // sends instantly.
  if (withLatency) await sleep(connectLatencyMs(deal));
  const detail =
    channel === "voice"
      ? `simulated outbound call to ${deal.business.phone ?? "owner"}`
      : channel === "whatsapp"
        ? `simulated WhatsApp to ${deal.business.phone ?? "owner"}`
        : `simulated email to ${deal.business.contact}`;
  return { ok: true, channel, ref: `sim-${channel}-${deal.id}`, simulated: true, detail };
}

/**
 * Send one outbound contact on the deal's preferred channel. Falls back to
 * simulation if live is disabled or the channel errors — the loop never stalls.
 */
export async function sendOutbound(
  deal: Deal,
  artifact: Artifact,
  opts: { simulateLatency?: boolean } = {},
): Promise<OutboundResult> {
  const channel = deal.channel;
  if (liveOutboundEnabled()) {
    try {
      if (channel === "voice") return await liveVoice(deal);
      if (channel === "whatsapp") return await liveWhatsApp(deal, artifact);
      return await liveEmail(deal, artifact);
    } catch {
      // fall through to simulation so a misconfigured channel can't break the run
    }
  }
  return simulate(deal, channel, opts.simulateLatency ?? false);
}

export function channelVerb(channel: OutboundChannel): string {
  return channel === "voice" ? "Calling" : channel === "whatsapp" ? "WhatsApp to" : "Emailing";
}
