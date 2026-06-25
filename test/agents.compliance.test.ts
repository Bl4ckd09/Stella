import { describe, it, expect } from "vitest";
import {
  reviewArtifact,
  allowedFigures,
  moneyIntegers,
  extractFigures,
  BANNED_PHRASES,
} from "../src/lib/agents/compliance";
import type { Artifact, Deal } from "../src/lib/agents/types";

function deal(over: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    business: {
      name: "The Daily Grind Coffee",
      postcode: "E8 3RH",
      borough: "Hackney",
      sector: "cafe",
      rateableValue: 11500,
      uarn: "DEMO-0001",
      address: "42 Mare Street, London",
      contact: "Priya Sharma",
      channel: "email",
      consent: true,
      consentSource: "web scan opt-in",
    },
    stage: "qualified",
    product: null,
    consent: true,
    consentSource: "web scan opt-in",
    money: { estAnnualSaving: 4393, estBackdated: 13179, confirmedBackdated: null },
    findings: [
      {
        headline: "Small Business Rate Relief — 100% off",
        annual_value: 4393,
        backdated_value: 13179,
        confidence: "high",
        rule: "SBRR 2026/27",
        action: "Apply to your council.",
        explanation: "RV £11,500 qualifies for 100% SBRR on a gross bill of £4,393/yr, saving £4,393/yr.",
        source: "https://www.gov.uk/",
      },
    ],
    confidence: "high",
    channel: "email",
    authorized: false,
    artifacts: [],
    history: [],
    waitUntil: null,
    createdTick: 0,
    updatedTick: 0,
  } as Deal;
}

function artifact(kind: Artifact["kind"], body: string): Artifact {
  return { id: "a1", kind, author: "closer", title: "Test", body, createdTick: 0, review: null };
}

const CLEAN_OUTREACH =
  "Hi Priya, our free scan suggests you may qualify for an estimated £4,393/yr in Small Business Rate Relief. " +
  "These are estimates and must be confirmed by your council. You can apply to Hackney council directly for free, " +
  "or get a £49 claim pack or £199 admin support.";

describe("compliance guard — money trace", () => {
  it("extracts £ figures and integer pounds", () => {
    expect(moneyIntegers("save £4,393/yr and £13,179 backdated")).toEqual([4393, 13179]);
    expect(extractFigures("£49 and £1,200.50")).toEqual(["£49", "£1,200.50"]);
  });

  it("allows engine figures, rateable value, and MVP prices", () => {
    const a = allowedFigures(deal());
    expect(a.has(4393)).toBe(true); // annual saving
    expect(a.has(13179)).toBe(true); // backdated
    expect(a.has(11500)).toBe(true); // rateable value (VOA fact)
    expect(a.has(49)).toBe(true);
    expect(a.has(199)).toBe(true);
  });

  it("blocks a hallucinated £ figure not traceable to the engine", () => {
    const v = reviewArtifact(deal(), artifact("outreach", CLEAN_OUTREACH + " You are due an extra £9,999."));
    expect(v.pass).toBe(false);
    expect(v.untracedFigures).toContain("£9,999");
  });
});

describe("compliance guard — banned phrasing", () => {
  it("passes a clean, fully-disclosed outreach", () => {
    const v = reviewArtifact(deal(), artifact("outreach", CLEAN_OUTREACH));
    expect(v.pass).toBe(true);
  });

  it("blocks 'you are owed' and 'guaranteed refund'", () => {
    const v1 = reviewArtifact(deal(), artifact("outreach", CLEAN_OUTREACH + " You are owed this money."));
    expect(v1.pass).toBe(false);
    expect(v1.bannedHits).toContain("you are owed");

    const v2 = reviewArtifact(deal(), artifact("outreach", CLEAN_OUTREACH + " This is a guaranteed refund."));
    expect(v2.pass).toBe(false);
    expect(v2.bannedHits).toContain("guaranteed refund");
  });

  it("allows the honest disclaimer 'Stella does not guarantee approval'", () => {
    const body = CLEAN_OUTREACH + " Stella does not guarantee approval, refund or relief.";
    const v = reviewArtifact(deal(), artifact("claim_pack", body));
    expect(v.bannedHits).not.toContain("guaranteed");
    expect(v.pass).toBe(true);
  });

  it("has the core banned terms from the PRD", () => {
    for (const p of ["guaranteed", "you are owed", "no win no fee", "government-approved"]) {
      expect(BANNED_PHRASES).toContain(p);
    }
  });
});

describe("compliance guard — required disclosures", () => {
  it("blocks outreach missing the free-council-route disclosure", () => {
    const body = "Hi Priya, you may qualify for an estimated £4,393/yr. This must be confirmed by your council.";
    const v = reviewArtifact(deal(), artifact("outreach", body));
    expect(v.pass).toBe(false);
    expect(v.missingDisclosures).toContain("free council route disclosed");
  });

  it("does not require the free-route marketing line inside a letter to the council", () => {
    const body =
      "To Hackney Council Business Rates Team. We apply for Small Business Rate Relief for RV £11,500, " +
      "estimated £4,393/yr. The council decides eligibility.";
    const v = reviewArtifact(deal(), artifact("council_letter", body));
    expect(v.missingDisclosures).toEqual([]);
    expect(v.pass).toBe(true);
  });
});
