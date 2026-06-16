/**
 * Twilio SMS sender — used by the voice agent to text a generated claim letter
 * to the caller. Server-only: the auth token must never reach the client.
 */
const TWILIO_BASE = "https://api.twilio.com/2010-04-01";

export interface SmsResult {
  ok: boolean;
  sid?: string;
  error?: string;
  code?: number;
}

/** Loose E.164 tidy-up: keep a leading +, strip spaces/dashes/parens. */
export function normalizePhone(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const plus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (!digits) return "";
  return plus ? `+${digits}` : digits;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!sid || !token || !from) return { ok: false, error: "twilio_not_configured" };
  const dest = normalizePhone(to);
  if (!dest) return { ok: false, error: "no_destination" };

  const form = new URLSearchParams({ To: dest, From: from, Body: body });
  const res = await fetch(`${TWILIO_BASE}/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
  if (!res.ok) return { ok: false, error: json.message || `http_${res.status}`, code: json.code };
  return { ok: true, sid: json.sid };
}
