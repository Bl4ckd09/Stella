/**
 * Deterministic business-rates relief engine — England 2026/27.
 *
 * LLM BOUNDARY: This module computes all £ figures. The LLM never calls
 * assess() and never modifies these outputs. All numbers trace to gov.uk.
 *
 * Ported verbatim from the original Stella `engines/rules_relief.py`.
 * Parity is enforced by test/relief.parity.test.ts against fixtures captured
 * from the Python original. Do not change a number here without updating the
 * source citation and regenerating fixtures.
 *
 * Sources:
 *   Multipliers:     gov.uk notification 2/2026
 *   SBRR:            gov.uk/apply-for-business-rate-relief/small-business-rate-relief
 *   Pub/live music:  gov.uk publication 1/2026
 *   SSB 2026:        gov.uk SSB LA guidance 2026
 */

// 2026/27 multipliers — pence per £1 RV (notification 2/2026)
export const MULT_SB_NON_RHL = 0.432; // small-business, not RHL use
export const MULT_SB_RHL = 0.382; // small-business, RHL use  (RV < £51k)
export const MULT_STD_NON_RHL = 0.48; // standard, not RHL
export const MULT_STD_RHL = 0.43; // standard, RHL use         (RV £51k–£499k)
export const MULT_HIGH = 0.508; // high-value                (RV ≥ £500k)

// Retail/Hospitality/Leisure sectors → lower multiplier
export const RHL_SECTORS = new Set(["retail", "cafe", "pub", "hospitality", "leisure"]);

// Pub/live-music relief: ONLY these qualify for 15% extra
export const PUB_QUALIFYING = new Set(["pub"]);

// Explicitly excluded from pub/live-music relief (per gov.uk 1/2026)
export const PUB_EXCLUDED = new Set([
  "cafe", "restaurant", "nightclub", "hotel", "guesthouse",
  "snack_bar", "sporting", "festival", "theatre", "cinema",
  "museum", "exhibition", "casino",
]);

export type Sector =
  | "retail" | "cafe" | "pub" | "hospitality"
  | "office" | "industrial" | "leisure" | "other";

export type Confidence = "high" | "medium" | "low";

export interface Business {
  name: string;
  rateable_value: number;
  borough: string;
  sector: string;
  uarn?: string;
  address?: string;
  postcode?: string;
  composite?: boolean;
}

export interface ReliefFinding {
  headline: string;
  annual_value: number; // £/yr this relief saves
  backdated_value: number; // £ lump (conservative 3-yr estimate from Apr 2023)
  confidence: Confidence;
  rule: string;
  action: string;
  explanation: string;
  source: string;
}

/** Round to 2 decimals, matching Python's round() for these magnitudes. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Format an integer with thousands separators, matching Python f"{x:,.0f}". */
function fmt0(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** Format a percentage with no decimals, matching Python f"{x:.0f}". */
function pct0(n: number): string {
  return n.toFixed(0);
}

export function multiplier(rv: number, sector: string): number {
  const isRhl = RHL_SECTORS.has(sector);
  if (rv >= 500_000) return MULT_HIGH;
  if (rv >= 51_000) return isRhl ? MULT_STD_RHL : MULT_STD_NON_RHL;
  return isRhl ? MULT_SB_RHL : MULT_SB_NON_RHL;
}

export function grossBill(rv: number, sector: string): number {
  return rv * multiplier(rv, sector);
}

/** SBRR discount fraction (0.0–1.0). 1% per £30 over £12,000 taper. */
export function sbrrPct(rv: number): number {
  if (rv <= 12_000) return 1.0;
  if (rv < 15_000) {
    const steps = (rv - 12_000) / 30.0;
    return Math.max(0.0, 1.0 - steps * 0.01);
  }
  return 0.0;
}

/** Return all applicable relief findings for a business. Never throws. */
export function assess(biz: Business): ReliefFinding[] {
  const findings: ReliefFinding[] = [];
  const rv = biz.rateable_value;
  const gross = grossBill(rv, biz.sector);

  // ── SBRR ──────────────────────────────────────────────────────────────
  const pct = sbrrPct(rv);
  if (pct > 0.0) {
    const saving = gross * pct;
    findings.push({
      headline: `Small Business Rate Relief — ${pct0(pct * 100)}% off`,
      annual_value: round2(saving),
      backdated_value: round2(saving * 3),
      confidence: "high",
      rule: "SBRR 2026/27",
      action:
        "Apply to your billing authority (council) — it is NOT automatic. " +
        "Ask them to backdate to April 2023 (start of current rating list). " +
        "Some councils backdate further — always ask.",
      explanation:
        `RV £${fmt0(rv)} qualifies for ${pct0(pct * 100)}% SBRR on a ` +
        `gross bill of £${fmt0(gross)}/yr, saving £${fmt0(saving)}/yr. ` +
        "Councils typically backdate to April 2023 (start of 2023 rating list) " +
        "— 3 years of unclaimed relief shown here as a conservative estimate.",
      source: "https://www.gov.uk/apply-for-business-rate-relief/small-business-rate-relief",
    });
  }

  // ── 2026 revaluation challenge wedge ───────────────────────────────────
  if (rv > 12_000 && rv <= 16_000) {
    findings.push({
      headline: "2026 Revaluation — possible challenge",
      annual_value: 0.0,
      backdated_value: 0.0,
      confidence: "medium",
      rule: "2026 Revaluation challenge wedge",
      action: "Check via gov.uk/business-rates-valuation-account.",
      explanation:
        `RV £${fmt0(rv)} is near the SBRR cliff (£12k/£15k). ` +
        "The April 2026 revaluation may have pushed you just over — " +
        "a challenge could restore full or partial relief.",
      source: "https://www.gov.uk/business-rates-valuation-account",
    });
  }

  // ── Pub & live music relief ────────────────────────────────────────────
  if (PUB_QUALIFYING.has(biz.sector) && !PUB_EXCLUDED.has(biz.sector)) {
    const pubSaving = gross * 0.15;
    findings.push({
      headline: "Pub & Live Music Venue Relief — 15% off",
      annual_value: round2(pubSaving),
      backdated_value: round2(pubSaving), // 2026/27 only
      confidence: "high",
      rule: "Pub/live-music relief 2026/27 (gov.uk 1/2026)",
      action: "Verify your bill — billing authority should apply automatically.",
      explanation:
        `Qualifying pub: 15% off gross bill (£${fmt0(gross)}/yr → ` +
        `saving £${fmt0(pubSaving)}/yr for 2026/27).`,
      source:
        "https://www.gov.uk/government/publications/" +
        "12026-pubs-and-live-music-venues-relief-2026-to-2027/" +
        "12026-pubs-and-live-music-venues-relief-2026-to-2027",
    });
  }

  // ── City of London flag ────────────────────────────────────────────────
  if (biz.borough.toLowerCase().includes("city of london")) {
    findings.push({
      headline: "City of London — special arrangements apply",
      annual_value: 0.0,
      backdated_value: 0.0,
      confidence: "low",
      rule: "City of London special arrangements",
      action: "Contact the City of London Corporation for your relief position.",
      explanation:
        "The City of London has separate billing authority arrangements. " +
        "No national figure is asserted — verify locally.",
      source: "https://www.cityoflondon.gov.uk/business/business-rates",
    });
  }

  return findings;
}

export interface Totals {
  total_annual_savings: number;
  total_backdated: number;
  highest_confidence: "high" | "medium" | "low" | "none";
}

/** Aggregate findings into the totals block used across the API. */
export function totals(findings: ReliefFinding[]): Totals {
  const totalAnnual = findings.reduce((s, f) => s + f.annual_value, 0);
  const totalBack = findings.reduce((s, f) => s + f.backdated_value, 0);
  const confs = findings.map((f) => f.confidence);
  const highest = confs.includes("high")
    ? "high"
    : confs.includes("medium")
      ? "medium"
      : confs.includes("low")
        ? "low"
        : "none";
  return {
    total_annual_savings: round2(totalAnnual),
    total_backdated: round2(totalBack),
    highest_confidence: highest,
  };
}
