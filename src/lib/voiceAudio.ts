export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;
export const MAX_QUEUED_AUDIO_SECONDS = 4;

export function normalizeGatewayUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("The voice gateway URL must use HTTP or WebSocket transport");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function pcm16ToFloat32(bytes: ArrayBuffer): Float32Array {
  const input = new Int16Array(bytes);
  const output = new Float32Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    output[i] = input[i] < 0 ? input[i] / 32768 : input[i] / 32767;
  }
  return output;
}

export function shouldResetPlaybackQueue(
  currentTime: number,
  nextAudioTime: number,
  maximumSeconds = MAX_QUEUED_AUDIO_SECONDS,
): boolean {
  return nextAudioTime - currentTime > maximumSeconds;
}
