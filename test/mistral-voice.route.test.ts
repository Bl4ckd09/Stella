import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  runByName: vi.fn(),
  isPostcode: vi.fn(),
  bizProfile: vi.fn(),
  boroughContact: vi.fn(),
  logLookup: vi.fn(),
  chat: vi.fn(),
  sendSms: vi.fn(),
  normalizePhone: vi.fn((raw: unknown) => String(raw ?? "").trim()),
}));

vi.mock("@/lib/lookup", () => ({
  run: mocks.run,
  runByName: mocks.runByName,
  isPostcode: mocks.isPostcode,
}));

vi.mock("@/lib/bizProfile", () => ({
  bizProfile: mocks.bizProfile,
}));

vi.mock("@/lib/db", () => ({
  boroughContact: mocks.boroughContact,
  logLookup: mocks.logLookup,
}));

vi.mock("@/lib/llm", () => ({
  chat: mocks.chat,
}));

vi.mock("@/lib/sms", () => ({
  sendSms: mocks.sendSms,
  normalizePhone: mocks.normalizePhone,
}));

function request(body: unknown): Request {
  return new Request("http://localhost/api/mistral-voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function loadPost() {
  const route = await import("../src/app/api/mistral-voice/route");
  return route.POST;
}

describe("POST /api/mistral-voice", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("MISTRAL_API_KEY", "test-mistral-key");
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 503 when MISTRAL_API_KEY is unset", async () => {
    vi.stubEnv("MISTRAL_API_KEY", "");
    const POST = await loadPost();

    const res = await POST(request({ text: "hello" }) as never);
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json).toEqual({ error: "mistral_not_configured" });
  });

  it("handles happy path text input with reply and timings", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "I can help with that." } }] });
      }
      if (href.endsWith("/audio/speech")) {
        return Response.json({ audio_data: "BASE64_MP3" });
      }
      throw new Error(`unexpected fetch ${href}`);
    }));
    const POST = await loadPost();

    const res = await POST(request({ text: "Can you check my business?", history: [] }) as never);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.user_text).toBe("Can you check my business?");
    expect(json.reply_text).toBe("I can help with that.");
    expect(json.audio_base64).toBe("BASE64_MP3");
    expect(json.audio_format).toBe("mp3");
    expect(json.history).toEqual([
      { role: "user", content: "Can you check my business?" },
      { role: "assistant", content: "I can help with that." },
    ]);
    expect(json.timings.stt_ms).toBe(0);
    expect(typeof json.timings.chat_ms).toBe("number");
    expect(typeof json.timings.tts_ms).toBe("number");
    expect(typeof json.timings.total_ms).toBe("number");
  });

  it("executes lookup_business tool calls and feeds the result back to chat", async () => {
    const property = {
      uarn: "123",
      name: "Souls Food UK",
      address: "1 High Street",
      postcode: "E4 6SY",
      borough: "Waltham Forest",
      sector: "retail",
      rateable_value: 12000,
      gross_annual_bill: 0,
      findings: [{ headline: "Small Business Rate Relief", annual_value: 6000 }],
      totals: { total_annual_savings: 6000, total_backdated: 18000, highest_confidence: "high" },
    };
    mocks.bizProfile.mockResolvedValue({
      step: "analysis",
      property,
      council: { phone: "020 0000 0000", email: "rates@example.gov.uk", apply_url: "https://example.gov.uk" },
    });
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/chat/completions") && fetchMock.mock.calls.length === 1) {
        return Response.json({
          choices: [{
            message: {
              content: null,
              tool_calls: [{
                id: "call_lookup",
                type: "function",
                function: {
                  name: "lookup_business",
                  arguments: JSON.stringify({ business_name: "Souls Food UK", postcode: "E4 6SY" }),
                },
              }],
            },
          }],
        });
      }
      if (href.endsWith("/chat/completions")) {
        return Response.json({ choices: [{ message: { content: "Good news. You could claim £6,000 per year." } }] });
      }
      if (href.endsWith("/audio/speech")) {
        return Response.json({ audio_data: "BASE64_MP3" });
      }
      throw new Error(`unexpected fetch ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const POST = await loadPost();

    const res = await POST(request({ text: "Look up Souls Food UK at E4 6SY" }) as never);
    const json = await res.json();
    const chatBodies = fetchMock.mock.calls
      .filter(([url]) => String(url).endsWith("/chat/completions"))
      .map(([, init]) => JSON.parse(String(init?.body)));

    expect(res.status).toBe(200);
    expect(mocks.bizProfile).toHaveBeenCalledWith({ name: "Souls Food UK", postcode: "E4 6SY" });
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies[1].messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "tool",
        tool_call_id: "call_lookup",
        content: expect.stringContaining("\"spoken_summary\""),
      }),
    ]));
    expect(json.reply_text).toBe("Good news. You could claim £6,000 per year.");
  });
});
