import type { NextRequest } from "next/server";

function firstAddress(value: string | null): string | null {
  const address = value?.split(",")[0]?.trim();
  return address || null;
}

export function trustedClientIp(req: NextRequest): string {
  if (process.env.VERCEL === "1") {
    return (
      firstAddress(req.headers.get("x-vercel-forwarded-for")) ||
      firstAddress(req.headers.get("x-real-ip")) ||
      "unknown"
    );
  }

  if (process.env.TRUST_PROXY_HEADERS === "true") {
    return (
      firstAddress(req.headers.get("x-forwarded-for")) ||
      firstAddress(req.headers.get("x-real-ip")) ||
      "unknown"
    );
  }

  return "unknown";
}

export function configuredAppHost(): string | null {
  const appUrl = process.env.STELLA_APP_URL;
  if (!appUrl) return null;
  try {
    return new URL(appUrl).host;
  } catch {
    return null;
  }
}
