/**
 * Compliance & oversight guard — the safety layer that lets the business run
 * autonomously without going off the rails.
 *
 * This is a PURE, deterministic function (no LLM, no network) so it can be
 * unit-tested and trusted as a hard gate. The Compliance agent (Quinn) runs
 * every outbound artifact through it, and the orchestrator refuses to release
 * any artifact whose verdict does not pass.
 *
 * It enforces three things from the PRD:
 *   1. Banned positioning (§8.2) — "owed", "guaranteed", "no win no fee", …
 *   2. Required disclosures (§11.1, §14.2) — free council route + estimate caveat.
 *   3. The SACRED money rule — every £ figure in agent text must trace to a
 *      figure the deterministic engine actually produced. Anything else is a
 *      hallucinated number and the artifact is blocked.
 */
import type { Artifact, ComplianceVerdict, Deal } from "./types";

/** Banned phrases (PRD §8.2 + §15.6). Matched case-insensitively. */
export const BANNED_PHRASES: string[] = [
  "you are owed",
  "owed to you",
  "guaranteed refund",
  "guaranteed",
  "claim your money now",
  "no win, no fee",
  "no win no fee",
  "government-approved",
  "government approved",
  "council-approved",
  "council approved",
  "fca-approved",
  "fca approved",
  "hmrc-approved",
  "hmrc approved",
  "risk-free compensation",
  "you definitely qualify",
  "money the council hid",
  "compensation",
  "redress",
];

/**
 * Phrases that are themselves benign but would otherwise trip the substring
 * matcher (e.g. the disclosure "Stella does not guarantee approval"). We strip
 * these before scanning for banned phrases so honest disclaimers are allowed.
 */
const SAFE_NEGATIONS: string[] = [
  "does not guarantee",
  "cannot guarantee",
  "no guarantee",
  "not guaranteed",
];

const GBP_RE = /£\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/g;

/** Integer-pound value of every £ figure in a string. */
export function moneyIntegers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(GBP_RE)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n)) out.push(Math.round(n));
  }
  return out;
}

/** Raw £ tokens (for reporting which figures were untraced). */
export function extractFigures(text: string): string[] {
  return [...text.matchAll(GBP_RE)].map((m) => m[0].replace(/\s/g, ""));
}

/**
 * The set of integer-pound figures the engine authorised for a deal: the
 * structured money fields, the product prices, every £ number that already
 * appears in engine-authored finding text, and the statutory thresholds the
 * engine itself cites. Any £ figure outside this set is a hallucination.
 */
export function allowedFigures(deal: Deal): Set<number> {
  const allowed = new Set<number>([0, 49, 199]); // £0 + the two MVP prices
  // Statutory constants the engine references (SBRR taper, revaluation bands).
  for (const c of [12000, 15000, 16000, 51000, 500000, 750]) allowed.add(c);

  // The rateable value is a VOA fact carried on the prospect, not an LLM number.
  allowed.add(Math.round(deal.business.rateableValue));

  const m = deal.money;
  for (const n of [m.estAnnualSaving, m.estBackdated, m.confirmedBackdated]) {
    if (typeof n === "number" && Number.isFinite(n)) allowed.add(Math.round(n));
  }
  for (const f of deal.findings) {
    allowed.add(Math.round(f.annual_value));
    allowed.add(Math.round(f.backdated_value));
    // Pull any £ figures the engine wrote into its own prose (gross bill etc.).
    for (const n of moneyIntegers(`${f.headline} ${f.explanation} ${f.action}`)) {
      allowed.add(n);
    }
  }
  return allowed;
}

function findBanned(text: string): string[] {
  let scrubbed = text.toLowerCase();
  for (const safe of SAFE_NEGATIONS) scrubbed = scrubbed.split(safe).join(" ··· ");
  const hits: string[] = [];
  for (const phrase of BANNED_PHRASES) {
    if (scrubbed.includes(phrase)) hits.push(phrase);
  }
  return hits;
}

interface DisclosureCheck {
  id: string;
  ok: boolean;
}

/** Disclosure requirements vary by artifact kind. */
function checkDisclosures(kind: Artifact["kind"], text: string): DisclosureCheck[] {
  const t = text.toLowerCase();
  const mentionsFreeRoute =
    t.includes("council") && t.includes("free") && /apply|direct|yourself|contact/.test(t);
  const mentionsEstimate =
    /estimate|estimated|potential|may (qualify|be)/.test(t) &&
    (t.includes("confirm") || t.includes("council"));

  switch (kind) {
    case "outreach":
    case "claim_pack":
      return [
        { id: "free council route disclosed", ok: mentionsFreeRoute },
        { id: "figures shown as estimates", ok: mentionsEstimate },
      ];
    case "customer_update":
      return [{ id: "figures shown as estimates", ok: mentionsEstimate }];
    // A letter addressed TO the council does not market the free route to itself.
    case "council_letter":
      return [];
  }
}

/**
 * Review one artifact for a deal. Pure + deterministic — the hard safety gate.
 */
export function reviewArtifact(deal: Deal, artifact: Artifact): ComplianceVerdict {
  const text = `${artifact.title}\n${artifact.body}`;

  const bannedHits = findBanned(text);

  const missingDisclosures = checkDisclosures(artifact.kind, text)
    .filter((c) => !c.ok)
    .map((c) => c.id);

  const allowed = allowedFigures(deal);
  const untracedFigures = [...new Set(extractFigures(text))].filter((tok) => {
    const n = Math.round(Number(tok.replace(/[£,]/g, "")));
    return !allowed.has(n);
  });

  const reasons: string[] = [];
  if (bannedHits.length) reasons.push(`banned phrasing: ${bannedHits.join(", ")}`);
  if (missingDisclosures.length) reasons.push(`missing disclosure: ${missingDisclosures.join(", ")}`);
  if (untracedFigures.length)
    reasons.push(`£ figure not traceable to the engine: ${untracedFigures.join(", ")}`);

  const pass = bannedHits.length === 0 && missingDisclosures.length === 0 && untracedFigures.length === 0;
  if (pass) reasons.push("clean: no banned claims, disclosures present, all figures trace to the engine");

  return {
    pass,
    reasons,
    bannedHits,
    missingDisclosures,
    untracedFigures,
    reviewedBy: "compliance",
  };
}
