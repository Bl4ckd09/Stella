import { describe, it, expect } from "vitest";
import {
  initState,
  tick,
  hasWork,
  decideApproval,
  requiresApproval,
  assessProspect,
  dispatchOutbound,
  outreachReady,
} from "../src/lib/agents/orchestrator";
import { SEED_PROSPECTS } from "../src/lib/agents/prospects";
import type { AutonomyLevel, BusinessState, Deal, ProspectBusiness } from "../src/lib/agents/types";

function qualifiedDeal(p: ProspectBusiness, id: string): Deal {
  const a = assessProspect(p);
  return {
    id, business: p, stage: "qualified", product: null, money: a.money, findings: a.findings,
    confidence: a.confidence, channel: p.channel, consent: p.consent, consentSource: p.consentSource,
    authorized: false, artifacts: [], history: [], waitUntil: null, createdTick: 0, updatedTick: 0,
  };
}

/** Run the company to completion, auto-approving + auto-running outbound campaigns. */
async function runToCompletion(autonomy: AutonomyLevel): Promise<BusinessState> {
  let state = initState(autonomy);
  let guard = 0;
  while (guard++ < 600) {
    for (const a of state.approvals.filter((x) => x.decided === null)) {
      state = decideApproval(state, a.id, "approved");
    }
    const { toContact, toHold } = outreachReady(state);
    if (toContact + toHold > 0) {
      state = (await dispatchOutbound(state, { useLLM: false, simulateLatency: false })).state;
      continue;
    }
    if (!hasWork(state)) break;
    state = (await tick(state, { useLLM: false })).state;
  }
  return state;
}

describe("orchestrator — autonomous run", () => {
  it("processes every prospect to a terminal stage with revenue + delivered value", async () => {
    const state = await runToCompletion("assisted");
    expect(state.deals.length).toBe(SEED_PROSPECTS.length);
    for (const d of state.deals) {
      expect(["closed", "lost", "disqualified", "needs_optin"]).toContain(d.stage);
    }
    expect(state.finances.revenue).toBeGreaterThan(0);
    expect(state.finances.customers).toBeGreaterThan(0);
    expect(state.finances.clientValueDelivered).toBeGreaterThan(0);
  });

  it("is deterministic — two runs produce identical financials", async () => {
    const a = await runToCompletion("assisted");
    const b = await runToCompletion("assisted");
    expect(a.finances).toEqual(b.finances);
    expect(a.tick).toBe(b.tick);
  });

  it("NEVER lets the LLM money rule break — every artifact passes compliance", async () => {
    const state = await runToCompletion("assisted");
    const artifacts = state.deals.flatMap((d) => d.artifacts);
    expect(artifacts.length).toBeGreaterThan(0);
    for (const art of artifacts) {
      expect(art.review).not.toBeNull();
      expect(art.review!.pass).toBe(true);
    }
  });

  it("enforces the authorization gate — no council letter without signed authority", async () => {
    const state = await runToCompletion("assisted");
    for (const d of state.deals) {
      const hasLetter = d.artifacts.some((a) => a.kind === "council_letter");
      if (hasLetter) expect(d.authorized).toBe(true);
    }
  });

  it("disqualifies prospects with no claimable relief instead of inventing value", async () => {
    const state = await runToCompletion("assisted");
    const dropped = state.deals.filter((d) => d.stage === "disqualified");
    expect(dropped.length).toBeGreaterThan(0);
    for (const d of dropped) expect(d.money.estAnnualSaving).toBe(0);
  });
});

describe("orchestrator — safety policy", () => {
  it("requiresApproval scales with the autonomy level", () => {
    expect(requiresApproval("high", "autopilot")).toBe(false);
    expect(requiresApproval("high", "assisted")).toBe(true);
    expect(requiresApproval("medium", "assisted")).toBe(false);
    expect(requiresApproval("medium", "supervised")).toBe(true);
    expect(requiresApproval("low", "supervised")).toBe(false);
  });

  it("assisted mode gates only the high-risk council submission", async () => {
    const state = await runToCompletion("assisted");
    expect(state.approvals.length).toBeGreaterThan(0);
    for (const ap of state.approvals) {
      expect(ap.action).toBe("submit_to_council");
      expect(ap.risk).toBe("high");
    }
  });

  it("autopilot creates no approvals (but the kill switch still works)", async () => {
    const state = await runToCompletion("autopilot");
    expect(state.approvals.length).toBe(0);

    const stopped = await tick({ ...initState("autopilot"), running: false }, { useLLM: false });
    expect(stopped.events.length).toBe(0);
    expect(stopped.state.tick).toBe(0);
  });
});

describe("orchestrator — parallel outbound dispatch", () => {
  const consented = SEED_PROSPECTS.find((p) => p.name === "The Daily Grind Coffee")!; // consent: true
  const notConsented = SEED_PROSPECTS.find((p) => p.name === "Greenwich Gelato")!; //    consent: false

  it("contacts consented owners and holds non-consented ones (consent gate)", async () => {
    const state = initState("autopilot");
    state.backlog = [];
    state.deals = [qualifiedDeal(consented, "deal-1"), qualifiedDeal(notConsented, "deal-2")];

    const res = await dispatchOutbound(state, { useLLM: false, simulateLatency: false });
    expect(res.dispatched).toBe(1);
    expect(res.skipped).toBe(1);

    const a = res.state.deals.find((d) => d.id === "deal-1")!;
    const b = res.state.deals.find((d) => d.id === "deal-2")!;
    expect(a.stage).toBe("contacted");
    expect(a.artifacts.some((x) => x.kind === "outreach" && x.review?.pass)).toBe(true);
    expect(b.stage).toBe("needs_optin");
    expect(b.artifacts.length).toBe(0); // never contacted
  });

  it("contacts many consented owners in one batch, all compliance-clean", async () => {
    const consentedSeeds = SEED_PROSPECTS.filter((p) => p.consent).slice(0, 5);
    const state = initState("autopilot");
    state.backlog = [];
    state.deals = consentedSeeds.map((p, i) => qualifiedDeal(p, `deal-${i + 1}`));

    const res = await dispatchOutbound(state, { useLLM: false, concurrency: 8, simulateLatency: false });
    expect(res.dispatched).toBe(consentedSeeds.length);
    const outreach = res.state.deals.flatMap((d) => d.artifacts).filter((x) => x.kind === "outreach");
    expect(outreach.length).toBe(consentedSeeds.length);
    for (const art of outreach) expect(art.review?.pass).toBe(true);
    // all events share one batch id + tick
    const batchEvents = res.events.filter((e) => e.batch);
    expect(batchEvents.length).toBe(res.events.length);
    expect(new Set(res.events.map((e) => e.tick)).size).toBe(1);
  });
});

describe("orchestrator — engine integration", () => {
  it("derives all money from the deterministic relief engine", () => {
    const cafe = SEED_PROSPECTS.find((p) => p.name === "The Daily Grind Coffee")!;
    const r = assessProspect(cafe);
    expect(r.money.estAnnualSaving).toBeGreaterThan(0);
    expect(r.confidence).toBe("high");

    const ineligible = SEED_PROSPECTS.find((p) => p.name === "The Workshop Co-Lab")!;
    const r2 = assessProspect(ineligible);
    expect(r2.money.estAnnualSaving).toBe(0);
  });
});
