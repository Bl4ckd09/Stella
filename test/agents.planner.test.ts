import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { plannerAvailable, choosePlan } from "../src/lib/agents/planner";
import { assessProspect } from "../src/lib/agents/orchestrator";
import { SEED_PROSPECTS } from "../src/lib/agents/prospects";
import type { ActionType, Deal, ProspectBusiness } from "../src/lib/agents/types";

function deal(p: ProspectBusiness, id: string): Deal {
  const a = assessProspect(p);
  return {
    id, business: p, stage: "qualified", product: null, money: a.money, findings: a.findings,
    confidence: a.confidence, channel: p.channel, consent: p.consent, consentSource: p.consentSource,
    authorized: false, artifacts: [], history: [], waitUntil: null, createdTick: 0, updatedTick: 0,
  };
}

function candidate(i: number, action: ActionType, score: number) {
  return { deal: deal(SEED_PROSPECTS[i], `deal-${i}`), action, score };
}

const SAVED = {
  provider: process.env.STELLA_AGENT_PROVIDER,
  lp: process.env.LLM_PROVIDER,
  base: process.env.LLM_BASE_URL,
  key: process.env.LLM_API_KEY,
  flag: process.env.STELLA_QWEN_PLANNER,
};
beforeEach(() => {
  for (const k of ["STELLA_AGENT_PROVIDER", "LLM_PROVIDER", "LLM_BASE_URL", "LLM_API_KEY", "STELLA_QWEN_PLANNER"]) {
    delete process.env[k];
  }
});
afterEach(() => {
  const restore = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v));
  restore("STELLA_AGENT_PROVIDER", SAVED.provider);
  restore("LLM_PROVIDER", SAVED.lp);
  restore("LLM_BASE_URL", SAVED.base);
  restore("LLM_API_KEY", SAVED.key);
  restore("STELLA_QWEN_PLANNER", SAVED.flag);
});

describe("planner — availability gating", () => {
  it("is unavailable with no openai-tier LLM configured (Claude default)", () => {
    expect(plannerAvailable()).toBe(false);
  });

  it("is available when the fast tier is an openai endpoint with a key", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    process.env.LLM_API_KEY = "sk-x";
    expect(plannerAvailable()).toBe(true);
  });

  it("can be force-disabled via STELLA_QWEN_PLANNER=false", () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    process.env.LLM_API_KEY = "sk-x";
    process.env.STELLA_QWEN_PLANNER = "false";
    expect(plannerAvailable()).toBe(false);
  });
});

describe("planner — choosePlan", () => {
  it("returns null when the planner is unavailable", async () => {
    const cands = [candidate(0, "scan", 40), candidate(1, "qualify", 50)];
    expect(await choosePlan(cands, null)).toBeNull();
  });

  it("returns null with fewer than two candidates (nothing to reorder)", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    process.env.LLM_API_KEY = "sk-x";
    expect(await choosePlan([candidate(0, "scan", 40)], null)).toBeNull();
  });

  it("never throws and returns null when the endpoint is unreachable", async () => {
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
    process.env.LLM_API_KEY = "sk-invalid-does-not-exist";
    const cands = [candidate(0, "scan", 40), candidate(1, "qualify", 50)];
    // real fetch to a bad key → API error → choosePlan swallows it → null
    expect(await choosePlan(cands, "Recalled experience: none")).toBeNull();
  });
});
