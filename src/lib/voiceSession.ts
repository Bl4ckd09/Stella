import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const VOICE_TOKEN_AUDIENCE = "stella-voxtral-gateway";
export const VOICE_TOKEN_TTL_SECONDS = 60;

export interface VoiceTokenClaims {
  aud: typeof VOICE_TOKEN_AUDIENCE;
  exp: number;
  iat: number;
  jti: string;
  v: 1;
}

function encode(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

function signature(payload: string, secret: string): string {
  return encode(createHmac("sha256", secret).update(`v1.${payload}`).digest());
}

export function issueVoiceToken(
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  ttlSeconds = VOICE_TOKEN_TTL_SECONDS,
  tokenId = randomUUID(),
): { token: string; claims: VoiceTokenClaims } {
  if (secret.length < 32) throw new Error("VOICE_SESSION_SECRET must contain at least 32 characters");
  if (ttlSeconds < 30 || ttlSeconds > 300) throw new Error("Voice token TTL must be between 30 and 300 seconds");

  const claims: VoiceTokenClaims = {
    aud: VOICE_TOKEN_AUDIENCE,
    exp: nowSeconds + ttlSeconds,
    iat: nowSeconds,
    jti: tokenId,
    v: 1,
  };
  const payload = encode(JSON.stringify(claims));
  return { token: `v1.${payload}.${signature(payload, secret)}`, claims };
}

export function verifyVoiceToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): VoiceTokenClaims {
  const [version, payload, suppliedSignature, extra] = token.split(".");
  if (version !== "v1" || !payload || !suppliedSignature || extra) throw new Error("invalid_voice_token");

  const expected = decode(signature(payload, secret));
  const supplied = decode(suppliedSignature);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw new Error("invalid_voice_token");
  }

  const claims = JSON.parse(decode(payload).toString("utf8")) as VoiceTokenClaims;
  if (claims.v !== 1 || claims.aud !== VOICE_TOKEN_AUDIENCE) throw new Error("invalid_voice_token");
  if (!Number.isInteger(claims.iat) || !Number.isInteger(claims.exp)) throw new Error("invalid_voice_token");
  if (claims.iat > nowSeconds + 5 || claims.exp <= nowSeconds || claims.exp - claims.iat > 300) {
    throw new Error("expired_voice_token");
  }
  if (!claims.jti || claims.jti.length > 64) throw new Error("invalid_voice_token");
  return claims;
}

export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host.toLowerCase() === host.split(",")[0].trim().toLowerCase();
  } catch {
    return false;
  }
}
