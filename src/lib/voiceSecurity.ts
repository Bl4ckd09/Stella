import { createHmac } from "node:crypto";

interface RateDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface MemoryBucket {
  count: number;
  resetAt: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();
const memoryTokens = new Map<string, number>();
const RATE_LIMIT = 10;
const RATE_WINDOW_SECONDS = 60;

function mode(): "memory" | "supabase" {
  const configured = process.env.VOICE_SECURITY_MODE;
  if (configured === "memory" || configured === "supabase") return configured;
  return process.env.NODE_ENV === "test" ? "memory" : "supabase";
}

export function hashVoiceSecurityValue(secret: string, purpose: "jti" | "rate", value: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}

function supabaseSettings(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("voice_security_unavailable");
  return { url: url.replace(/\/$/, ""), key };
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { url, key } = supabaseSettings();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("voice_security_unavailable");
  return await response.json() as T;
}

export async function consumeVoiceSessionRateLimit(clientKey: string, secret: string): Promise<RateDecision> {
  const keyHash = hashVoiceSecurityValue(secret, "rate", clientKey);
  if (mode() === "memory") {
    const now = Date.now();
    let bucket = memoryBuckets.get(keyHash);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_SECONDS * 1_000 };
      memoryBuckets.set(keyHash, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= RATE_LIMIT,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
    };
  }

  const result = await rpc<{ allowed?: unknown; retry_after_seconds?: unknown }>("consume_voice_rate_limit", {
    p_key_hash: keyHash,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (typeof result.allowed !== "boolean" || typeof result.retry_after_seconds !== "number") {
    throw new Error("voice_security_unavailable");
  }
  return { allowed: result.allowed, retryAfterSeconds: Math.max(1, Math.ceil(result.retry_after_seconds)) };
}

export async function registerVoiceSessionToken(
  tokenId: string,
  expiresAtSeconds: number,
  secret: string,
): Promise<void> {
  const tokenHash = hashVoiceSecurityValue(secret, "jti", tokenId);
  if (mode() === "memory") {
    if (memoryTokens.has(tokenHash)) throw new Error("voice_security_unavailable");
    memoryTokens.set(tokenHash, expiresAtSeconds);
    return;
  }

  const registered = await rpc<boolean>("register_voice_session", {
    p_jti_hash: tokenHash,
    p_expires_at: new Date(expiresAtSeconds * 1_000).toISOString(),
  });
  if (registered !== true) throw new Error("voice_security_unavailable");
}

export function clearVoiceSecurityMemoryForTests(): void {
  memoryBuckets.clear();
  memoryTokens.clear();
}
