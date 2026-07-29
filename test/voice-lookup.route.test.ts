import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  logLookup: vi.fn(),
  property: {
    uarn: "1",
    name: "Shop",
    address: "1 High Street",
    postcode: "E4 6SY",
    borough: "Waltham Forest",
    sector: "retail",
    rateable_value: 10_000,
    gross_annual_bill: 4_990,
    findings: [{ headline: "Small Business Rate Relief", annual_value: 4_990, backdated_value: 14_970 }],
    totals: { total_annual_savings: 4_990, total_backdated: 14_970, highest_confidence: "eligible" },
  },
}));

vi.mock("@/lib/bizProfile", () => ({
  bizProfile: vi.fn(async () => ({ step: "analysis", property: mocks.property, council: { phone: "020 0000 0000" } })),
}));
vi.mock("@/lib/db", () => ({
  boroughContact: vi.fn(async () => ({ phone: "020 0000 0000" })),
  logLookup: mocks.logLookup,
}));
vi.mock("@/lib/lookup", () => ({
  run: vi.fn(),
  runByName: vi.fn(),
  isPostcode: vi.fn(() => false),
}));

import { POST } from "../src/app/api/voice-lookup/route";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("https://stella.example.com/api/voice-lookup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ business_name: "Souls Food UK", postcode: "E4 6SY" }),
  });
}

beforeEach(() => {
  mocks.logLookup.mockClear();
  process.env.VOICE_TOOL_SECRET = "tool-secret";
});

describe("voice lookup safety", () => {
  it("fails closed when the tool secret is absent", async () => {
    delete process.env.VOICE_TOOL_SECRET;
    expect((await POST(request())).status).toBe(503);
  });

  it("rejects an invalid tool secret", async () => {
    expect((await POST(request({ "x-tool-secret": "wrong" }))).status).toBe(401);
  });

  it("returns the engine-owned spoken summary without browser transcript storage", async () => {
    const response = await POST(request({ "x-tool-secret": "tool-secret", "x-voice-channel": "browser" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.spoken_summary).toContain("worth about £4,990 per year");
    expect(mocks.logLookup).not.toHaveBeenCalled();
  });

  it("keeps phone lookup logging unchanged", async () => {
    const response = await POST(request({ "x-tool-secret": "tool-secret" }));
    expect(response.status).toBe(200);
    expect(mocks.logLookup).toHaveBeenCalledOnce();
  });
});
