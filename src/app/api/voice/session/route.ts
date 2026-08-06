import { NextRequest, NextResponse } from "next/server";
import { isSameOrigin, issueVoiceToken, VOICE_TOKEN_TTL_SECONDS } from "@/lib/voiceSession";
import { consumeVoiceSessionRateLimit, registerVoiceSessionToken } from "@/lib/voiceSecurity";
import { configuredAppHost, trustedClientIp } from "@/lib/requestSecurity";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const host = configuredAppHost();
  if (!host) {
    return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
  }
  if (!isSameOrigin(req.headers.get("origin"), host)) {
    return NextResponse.json({ error: "cross_origin_blocked" }, { status: 403 });
  }
  const secret = process.env.VOICE_SESSION_SECRET;
  const gatewayUrl = process.env.VOXTRAL_GATEWAY_URL || process.env.NEXT_PUBLIC_VOXTRAL_GATEWAY_URL;
  if (!secret || secret.length < 32 || !gatewayUrl) {
    return NextResponse.json({ error: "voice_unavailable" }, { status: 503 });
  }

  try {
    const rate = await consumeVoiceSessionRateLimit(trustedClientIp(req), secret);
    if (!rate.allowed) {
      return NextResponse.json(
        { error: "rate_limited" },
        { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds) } },
      );
    }
    const { token, claims } = issueVoiceToken(secret);
    await registerVoiceSessionToken(claims.jti, claims.exp, secret);
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
