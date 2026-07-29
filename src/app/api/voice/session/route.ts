import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, issueVoiceToken, VOICE_TOKEN_TTL_SECONDS } from "@/lib/voiceSession";

export const runtime = "nodejs";

const buckets = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 10;
const WINDOW_MS = 60_000;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function allowed(ip: string, now = Date.now()): boolean {
  const current = buckets.get(ip);
  if (!current || current.resetAt <= now) {
    buckets.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  current.count += 1;
  return current.count <= LIMIT;
}

export async function POST(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!isSameOrigin(req.headers.get("origin"), host)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  if (!allowed(clientIp(req))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429, headers: { "retry-after": "60" } });
  }

  const secret = process.env.VOICE_SESSION_SECRET;
  const gatewayUrl = process.env.VOXTRAL_GATEWAY_URL || process.env.NEXT_PUBLIC_VOXTRAL_GATEWAY_URL;
  if (!secret || secret.length < 32 || !gatewayUrl) {
    return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
  }

  try {
    const { token, claims } = issueVoiceToken(secret);
    return NextResponse.json(
      {
        token,
        expires_at: claims.exp,
        expires_in: VOICE_TOKEN_TTL_SECONDS,
        gateway_url: gatewayUrl,
        input: { encoding: "pcm_s16le", sample_rate: 16_000, channels: 1 },
        output: { encoding: "pcm_s16le", sample_rate: 24_000, channels: 1 },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
  }
}
