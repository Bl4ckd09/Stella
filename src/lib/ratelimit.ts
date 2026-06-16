/**
 * Best-effort in-memory fixed-window rate limiter.
 *
 * Note: serverless instances each hold their own map, so this is per-instance
 * (an attacker spread across many instances sees a higher effective limit). It
 * adds real friction against naive/scripted abuse with zero external deps. For
 * hard global limits, back this with Vercel WAF rate-limit rules or Upstash.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, limit: number, windowMs: number): {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
} {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;

  // Opportunistic cleanup so the map can't grow unbounded.
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }

  return {
    ok: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)),
  };
}
