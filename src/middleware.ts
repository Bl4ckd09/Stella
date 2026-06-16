import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/ratelimit";

// Run only on the API surface.
export const config = { matcher: "/api/:path*" };

const WINDOW_MS = 60_000;
const API_LIMIT = 30; // per IP/min for browser-facing API
const VOICE_LIMIT = 120; // /api/voice-lookup is secret-gated → allow more

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function forbidden(reason: string) {
  return new NextResponse(JSON.stringify({ error: reason }), {
    status: 403,
    headers: { "content-type": "application/json" },
  });
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Both voice webhooks (/api/voice-lookup, /api/voice-letter) are server-to-
  // server calls from ElevenLabs, gated by their own X-Tool-Secret header and
  // carrying no Origin — exempt them from the same-origin check.
  const isVoice = path.startsWith("/api/voice-");
  const ip = clientIp(req);

  // 1) Rate limit per IP.
  const rl = rateLimit(`${ip}:${isVoice ? "voice" : "api"}`, isVoice ? VOICE_LIMIT : API_LIMIT, WINDOW_MS);
  if (!rl.ok) {
    return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(rl.retryAfterSec) },
    });
  }

  // 2) Same-origin enforcement for browser-facing mutating routes.
  //    /api/voice-lookup is a server-to-server webhook (no Origin) authenticated
  //    by its own X-Tool-Secret header — exempt it here.
  if (!isVoice && req.method === "POST") {
    const origin = req.headers.get("origin");
    const host = req.headers.get("host");
    if (!origin) return forbidden("cross_origin_blocked");
    try {
      if (new URL(origin).host !== host) return forbidden("cross_origin_blocked");
    } catch {
      return forbidden("cross_origin_blocked");
    }
  }

  return NextResponse.next();
}
