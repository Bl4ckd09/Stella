import { describe, it, expect } from "vitest";
import {
  initState,
  tick,
  hasWork,
  decideApproval,
  requiresApproval,
  assessProspect,
} from "../src/lib/agents/orchestrator";
import { SEED_PROSPECTS } from "../src/lib/agents/prospects";
import type { AutonomyLevel, BusinessState } from "../src/lib/agents/types";

/** Run the company to completion, auto-approving every gated action. */
async function runToCompletion(autonomy: AutonomyLevel): Promise<BusinessState> {
  let state = initState(autonomy);
  let guard = 0;
  while (guard++ < 600) {
    for (const a of state.approvals.filter((x) => x.decided === null)) {
      state = decideApproval(state, a.id, "approved");
    }
    if (!hasWork(state)) break;
    const res = await tick(state, { useLLM: false });
    state = res.state;
  }
  return state;
}

describe("orchestrator — autonomous run", () => {
  it("processes every prospect to a terminal stage with revenue + delivered value", async () => {
    const state = await runToCompletion("assisted");
    expect(state.deals.length).toBe(SEED_PROSPECTS.length);
    for (const d of state.deals) {
      expect(["closed", "lost", "disqualified"]).toContain(d.stage);
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
