import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/voice/session/route";
import { issueVoiceToken, isSameOrigin, verifyVoiceToken } from "../src/lib/voiceSession";

const SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN_VECTOR = "v1.eyJhdWQiOiJzdGVsbGEtdm94dHJhbC1nYXRld2F5IiwiZXhwIjoxNzAwMDAwMDYwLCJpYXQiOjE3MDAwMDAwMDAsImp0aSI6InRlc3Qtc2Vzc2lvbiIsInYiOjF9.aMMZotf06Pfw-p9TE2oo7RDxp69zQp-Yx0njZ1rRIQI";

afterEach(() => {
  delete process.env.VOICE_SESSION_SECRET;
  delete process.env.VOXTRAL_GATEWAY_URL;
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
});
