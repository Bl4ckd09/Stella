import { describe, expect, it } from "vitest";
import { normalizeGatewayUrl, pcm16ToFloat32 } from "../src/lib/voiceAudio";

describe("browser voice audio", () => {
  it("normalizes secure gateway URLs", () => {
    expect(normalizeGatewayUrl("https://voice.example.com/")).toBe("wss://voice.example.com");
    expect(normalizeGatewayUrl("ws://localhost:8000")).toBe("ws://localhost:8000");
    expect(() => normalizeGatewayUrl("ftp://voice.example.com")).toThrow();
  });

  it("converts signed PCM16 without clipping", () => {
    const pcm = new Int16Array([-32768, 0, 32767]);
    expect(Array.from(pcm16ToFloat32(pcm.buffer))).toEqual([-1, 0, 1]);
  });
});
