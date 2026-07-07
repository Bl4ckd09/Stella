import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  memoriesFromEvents,
  memoryRecallAvailable,
  recallExperience,
  cosine,
} from "../src/lib/agents/memory";
import { initState, assessProspect } from "../src/lib/agents/orchestrator";
import { SEED_PROSPECTS } from "../src/lib/agents/prospects";
import type { ActionType, AgentEvent, AgentMemory, BusinessState, Deal, ProspectBusiness } from "../src/lib/agents/types";

function deal(p: ProspectBusiness, id: string, over: Partial<Deal> = {}): Deal {
  const a = assessProspect(p);
  return {
    id, business: p, stage: "qualified", product: null, money: a.money, findings: a.findings,
    confidence: a.confidence, channel: p.channel, consent: p.consent, consentSource: p.consentSource,
    authorized: false, artifacts: [], history: [], waitUntil: null, createdTick: 0, updatedTick: 0, ...over,
  };
}

function ev(action: ActionType, dealId: string | null, over: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id: "ev-x", tick: 1, agent: "analyst", action, dealId,
    headline: "h", reasoning: "r", risk: "low", ...over,
  };
}

function stateWith(deals: Deal[], memories: AgentMemory[] = []): BusinessState {
  const s = initState("assisted");
  s.deals = deals;
  s.memories = memories;
  return s;
}

// Keep these tests hermetic regardless of any ambient .env — recall must use
// the deterministic fallback, never a real network call.
const SAVED = { base: process.env.LLM_BASE_URL, key: process.env.LLM_API_KEY };
beforeEach(() => {
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_API_KEY;
});
afterEach(() => {
  if (SAVED.base === undefined) delete process.env.LLM_BASE_URL;
  else process.env.LLM_BASE_URL = SAVED.base;
  if (SAVED.key === undefined) delete process.env.LLM_API_KEY;
  else process.env.LLM_API_KEY = SAVED.key;
});

describe("memory — cosine similarity", () => {
  it("is 1 for identical vectors, ~0 for orthogonal, 0 for a zero vector", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0, 6);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

describe("memory — memoriesFromEvents", () => {
  it("records only memorable, non-blocked, deal-linked events", () => {
    const d = deal(SEED_PROSPECTS[0], "deal-1");
    const s = stateWith([d]);
    const events = [
      ev("qualify", "deal-1"),
      ev("scan", "deal-1"), //           not memorable → skipped
      ev("disqualify", "deal-1", { blocked: true }), // blocked → skipped
      ev("convert", null), //            no dealId → skipped
      ev("record_outcome", "deal-1"),
    ];
    const mems = memoriesFromEvents(s, events);
    expect(mems.map((m) => m.text.length > 0)).toEqual([true, true]);
    expect(mems.map((m) => m.kind)).toEqual(["outcome", "outcome"]);
    // carries the deal's traits for prefiltering
    expect(mems[0].sector).toBe(d.business.sector);
    expect(mems[0].borough).toBe(d.business.borough);
  });

  it("numbers ids sequentially, continuing from existing memories", () => {
    const d = deal(SEED_PROSPECTS[0], "deal-1");
    const existing: AgentMemory[] = [
      { id: "mem-0001", tick: 0, agent: "analyst", kind: "outcome", text: "prior", sector: "x", borough: "y" },
    ];
    const s = stateWith([d], existing);
    const mems = memoriesFromEvents(s, [ev("qualify", "deal-1"), ev("lose", "deal-1")]);
    expect(mems.map((m) => m.id)).toEqual(["mem-0002", "mem-0003"]);
  });

  it("skips an event whose deal is not in state", () => {
    const s = stateWith([deal(SEED_PROSPECTS[0], "deal-1")]);
    expect(memoriesFromEvents(s, [ev("qualify", "ghost")])).toEqual([]);
  });
});

describe("memory — recallExperience (deterministic fallback)", () => {
  it("returns null when there is nothing remembered", async () => {
    const d = deal(SEED_PROSPECTS[0], "deal-1");
    expect(await recallExperience(stateWith([d]), d, "qualify")).toBeNull();
  });

  it("recalls the most recent related outcomes via the recency fallback", async () => {
    expect(memoryRecallAvailable()).toBe(false); // no dashscope env → fallback path
    const d = deal(SEED_PROSPECTS[0], "deal-1");
    const sec = d.business.sector;
    const bor = d.business.borough;
    const mems: AgentMemory[] = [1, 2, 3, 4].map((n) => ({
      id: `mem-000${n}`, tick: n, agent: "analyst", kind: "outcome",
      text: `${sec} in ${bor}: outcome ${n}.`, sector: sec, borough: bor,
    }));
    const recall = await recallExperience(stateWith([d], mems), d, "qualify");
    expect(recall).not.toBeNull();
    expect(recall!.via).toBe("recent");
    expect(recall!.count).toBe(3); // caps at 3
    // most recent first
    expect(recall!.text).toContain("outcome 4");
    expect(recall!.text).toContain("outcome 3");
    expect(recall!.text).toContain("outcome 2");
    expect(recall!.text).not.toContain("outcome 1");
  });

  it("never throws even when the network layer is configured but unreachable", async () => {
    process.env.LLM_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    process.env.LLM_API_KEY = "sk-invalid-does-not-exist";
    expect(memoryRecallAvailable()).toBe(true);
    const d = deal(SEED_PROSPECTS[0], "deal-1");
    const mems: AgentMemory[] = [{
      id: "mem-0001", tick: 1, agent: "analyst", kind: "outcome",
      text: `${d.business.sector} in ${d.business.borough}: outcome.`,
      sector: d.business.sector, borough: d.business.borough,
    }];
    // embed/rerank fail → still returns the recency fallback, no throw
    const recall = await recallExperience(stateWith([d], mems), d, "qualify");
    expect(recall).not.toBeNull();
    expect(recall!.via).toBe("recent");
  });
});
