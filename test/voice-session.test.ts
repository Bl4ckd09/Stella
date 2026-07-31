import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/voice/session/route";
import { issueVoiceToken, isSameOrigin, verifyVoiceToken } from "../src/lib/voiceSession";
import { clearVoiceSecurityMemoryForTests, hashVoiceSecurityValue } from "../src/lib/voiceSecurity";

const SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN_VECTOR = "v1.eyJhdWQiOiJzdGVsbGEtdm94dHJhbC1nYXRld2F5IiwiZXhwIjoxNzAwMDAwMDYwLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6InRlc3Qtc2Vzc2lvbiIsInYiOjF9.aMMZotf06Pfw-p9TE2oo7RDxp69zQp-Yx0njZ1rRIQI";

afterEach(() => {
  delete process.env.VOICE_SESSION_SECRET;
  delete process.env.VOXTRAL_GATEWAY_URL;
  delete process.env.VOICE_SECURITY_MODE;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.unstubAllGlobals();
  clearVoiceSecurityMemoryForTests();
});

describe("voice session tokens", () => {
  it("signs and verifies a short-lived token", () => {
    const { token } = issueVoiceToken(SECRET, 1_700_000_000, 60, "test-session");
    expect(token).toBe(TOKEN_VECTOR);
    expect(verifyVoiceToken(token, SECRET, 1_700_000_030)).toMatchObject({
      aud: "stella-voxtral-gateway",
      exp: 1_700_000_060,
      jti: "test-session",
    });
    expect(() => verifyVoiceToken(token, SECRET, 1_700_000_061)).toThrow("expired_voice_token");
  });

  it("rejects cross-origin requests", async () => {
    process.env.VOICE_SESSION_SECRET = SECRET;
    process.env.VOXTRAL_GATEWAY_URL = "https://gateway.example.com";
    const request = new NextRequest("https://stella.example.com/api/voice/session", {
      method: "POST",
      headers: { host: "stella.example.com", origin: "https://attacker.example.com", "x-forwarded-for": "test-cross" },
    });
    expect((await POST(request)).status).toBe(403);
  });

  it("fails closed when the secret is missing", async () => {
    process.env.VOXTRAL_GATEWAY_URL = "https://gateway.example.com";
    const request = new NextRequest("https://stella.example.com/api/voice/session", {
      method: "POST",
      headers: { host: "stella.example.com", origin: "https://stella.example.com", "x-forwarded-for": "test-config" },
    });
    expect((await POST(request)).status).toBe(503);
  });

  it("returns a no-store session for the same origin", async () => {
    process.env.VOICE_SESSION_SECRET = SECRET;
    process.env.VOXTRAL_GATEWAY_URL = "https://gateway.example.com";
    const request = new NextRequest("https://stella.example.com/api/voice/session", {
      method: "POST",
      headers: { host: "stella.example.com", origin: "https://stella.example.com", "x-forwarded-for": "test-ok" },
    });
    const response = await POST(request);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body.gateway_url).toBe("https://gateway.example.com");
    expect(verifyVoiceToken(body.token, SECRET)).toMatchObject({ aud: "stella-voxtral-gateway" });
  });

  it("compares origins by host", () => {
    expect(isSameOrigin("https://stella.example.com", "stella.example.com")).toBe(true);
    expect(isSameOrigin(null, "stella.example.com")).toBe(false);
  });

  it("rate limits session creation without storing the raw client address", async () => {
    process.env.VOICE_SESSION_SECRET = SECRET;
    process.env.VOXTRAL_GATEWAY_URL = "https://gateway.example.com";
    process.env.VOICE_SECURITY_MODE = "memory";
    const request = () => new NextRequest("https://stella.example.com/api/voice/session", {
      method: "POST",
      headers: { host: "stella.example.com", origin: "https://stella.example.com", "x-forwarded-for": "203.0.113.9" },
    });
    for (let index = 0; index < 10; index += 1) {
      expect((await POST(request())).status).toBe(200);
    }
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(hashVoiceSecurityValue(SECRET, "rate", "203.0.113.9")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the shared Supabase guard without sending the raw client address", async () => {
    process.env.VOICE_SESSION_SECRET = SECRET;
    process.env.VOXTRAL_GATEWAY_URL = "https://gateway.example.com";
    process.env.VOICE_SECURITY_MODE = "supabase";
    process.env.SUPABASE_URL = "https://project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ allowed: true, retry_after_seconds: 30 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response("true", {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const request = new NextRequest("https://stella.example.com/api/voice/session", {
      method: "POST",
      headers: { host: "stella.example.com", origin: "https://stella.example.com", "x-forwarded-for": "203.0.113.10" },
    });

    expect((await POST(request)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const rateBody = String(fetchMock.mock.calls[0][1]?.body);
    const tokenBody = String(fetchMock.mock.calls[1][1]?.body);
    expect(rateBody).not.toContain("203.0.113.10");
    expect(tokenBody).not.toContain("test-session");
    expect(rateBody).toMatch(/[a-f0-9]{64}/);
    expect(tokenBody).toMatch(/[a-f0-9]{64}/);
  });
});
