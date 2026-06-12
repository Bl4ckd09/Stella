/**
 * "My Business" flow: business name + postcode → verify company (Companies
 * House) → match VOA property → relief analysis + grants. Ported from the
 * Flask /api/biz-profile route, adapted to the Postgres data layer.
 *
 * Shared by the web route (full result) and the voice agent (concise summary).
 */
import { assess, grossBill, totals, type Business } from "./engines/relief";
import { matchGrants, type GrantMatch } from "./engines/grants";
import { run, type BusinessResult } from "./lookup";
import { companiesByName, companiesByPostcode, boroughContact, normPostcode, type CompanyRow } from "./db";
import { nameScore, nameToSector, sicToSector } from "./sectors";

const POSTCODE_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i;
const CURRENT_YEAR = 2026;

export interface BizProfileInput {
  name: string;
  postcode: string;
  sector?: string | null;
  uarn?: string;
}

export type BizProfileResult =
  | { step: "error"; error: string; status: number }
  | {
      step: "pick_property";
      properties: BusinessResult[];
      ch_profile: Record<string, unknown> | null;
      ch_verification: string;
      ch_note: string;
      sic_codes: string[];
      company_age_years: number | null;
      biz_name: string;
      postcode: string;
      sector: string | null;
      reason: string;
    }
  | {
      step: "analysis";
      property: BusinessResult;
      biz_name: string;
      ch_profile: Record<string, unknown> | null;
      ch_verification: string;
      ch_note: string;
      sic_codes: string[];
      company_age_years: number | null;
      grants: GrantMatch[];
      lsoa: string | null;
      council: Awaited<ReturnType<typeof boroughContact>>;
    };

function applySectorOverride(prop: BusinessResult, sector: string): BusinessResult {
  const rv = prop.rateable_value;
  const biz: Business = {
    name: prop.name, rateable_value: rv, borough: prop.borough, sector,
    uarn: prop.uarn, address: prop.address, postcode: prop.postcode,
  };
  const findings = assess(biz);
  return {
    ...prop,
    sector,
    gross_annual_bill: Math.round(grossBill(rv, sector) * 100) / 100,
    findings,
    totals: totals(findings),
  };
}

function ageFromCreation(created?: string | null): number | null {
  if (!created) return null;
  const year = parseInt(created.slice(0, 4), 10);
  return Number.isFinite(year) ? CURRENT_YEAR - year : null;
}

export async function bizProfile(input: BizProfileInput): Promise<BizProfileResult> {
  const bizName = input.name.trim();
  const postcode = input.postcode.trim().toUpperCase();
  const sectorOver = (input.sector ?? "").trim() || null;
  let selectedUarn = (input.uarn ?? "").trim();

  if (!bizName) return { step: "error", error: "Business name required", status: 400 };
  if (!postcode) return { step: "error", error: "Postcode required", status: 400 };
  if (!POSTCODE_RE.test(postcode)) {
    return { step: "error", error: "Invalid postcode — use format e.g. EC1N 7TE", status: 400 };
  }

  // ── 1. Companies House: verify the company (fuzzy name + postcode score) ─────
  let chProfile: Record<string, unknown> | null = null;
  let sicCodes: string[] = [];
  let companyAgeYears: number | null = null;
  let companyType = "";
  let chVerification = "not_found";
  let chNote = "";

  const pcNorm = normPostcode(postcode);
  let candidates: (CompanyRow & { similarity: number })[] = [];
  try {
    candidates = await companiesByName(bizName, 10);
  } catch {
    candidates = [];
  }

  if (candidates.length) {
    const scored = candidates.map((c) => {
      const ns = nameScore(bizName, c.name);
      const pcMatch = normPostcode(c.postcode ?? "") === pcNorm;
      return { score: ns + (pcMatch ? 20 : 0), pcMatch, c };
    });
    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    if (top && top.score >= 50) {
      const best = top.c;
      chProfile = {
        name: best.name, number: best.company_number, status: best.status,
        postcode: best.postcode, address: best.address,
      };
      sicCodes = [best.sic1, best.sic2].filter((s): s is string => Boolean(s));
      companyType = best.status ?? "";
      companyAgeYears = ageFromCreation(best.date_of_creation);
      const rawNameScore = nameScore(bizName, best.name);
      if (rawNameScore >= 100 && top.pcMatch) {
        chVerification = "verified";
        chNote = "Name and postcode match Companies House records.";
      } else if (rawNameScore >= 85) {
        chVerification = "likely";
        chNote = `Strong name match. Registered address: ${best.address ?? "unknown"} — may differ from trading address.`;
      } else {
        chVerification = "name_only";
        chNote = `Partial name match. Registered at ${best.postcode ?? "unknown"}. Trading address may differ.`;
      }
    } else if (top) {
      chNote = `No close match found. Closest: '${top.c.name}' — check the spelling.`;
    }
  }

  // Fallback: companies registered at this postcode.
  if (!sicCodes.length) {
    try {
      const localCos = await companiesByPostcode(postcode);
      if (localCos.length) {
        localCos.sort((a, b) => nameScore(bizName, b.name) - nameScore(bizName, a.name));
        if (nameScore(bizName, localCos[0].name) >= 50) {
          const c = localCos[0];
          sicCodes = [c.sic1, c.sic2].filter((s): s is string => Boolean(s));
          if (!chProfile) {
            chProfile = { name: c.name, number: c.company_number, status: c.status, sic_codes: sicCodes };
          }
          if (companyAgeYears === null) companyAgeYears = ageFromCreation(c.date_of_creation);
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Derive sector: override → SIC → name inference.
  const effectiveSector =
    sectorOver ?? sicToSector(sicCodes) ?? nameToSector((chProfile?.name as string) || bizName);

  // ── 2. VOA: all properties at postcode ──────────────────────────────────────
  const voaResult = await run(postcode);
  const allProps = voaResult.businesses;
  if (!allProps.length) {
    return {
      step: "error",
      error: `No properties found at ${postcode} in the VOA 2026 rating list. Check the postcode is correct.`,
      status: 404,
    };
  }

  // ── 3. Auto-select property ──────────────────────────────────────────────────
  if (!selectedUarn) {
    const bySavings = (a: BusinessResult, b: BusinessResult) =>
      b.totals.total_annual_savings - a.totals.total_annual_savings || a.rateable_value - b.rateable_value;
    const sectorMatches = effectiveSector ? allProps.filter((b) => b.sector === effectiveSector) : [];
    let pool = sectorMatches.length ? sectorMatches : allProps;
    pool.sort(bySavings);

    // If filtering by sector would hide every claimable unit (the matched unit(s)
    // are all £0, but eligible units exist elsewhere at this postcode), widen to
    // the whole postcode so the picker surfaces the units that can actually claim
    // — rather than silently auto-selecting an ineligible one and showing £0.
    const poolHasSavings = pool.some((b) => b.totals.total_annual_savings > 0);
    const postcodeHasSavings = allProps.some((b) => b.totals.total_annual_savings > 0);
    const widened = !poolHasSavings && postcodeHasSavings;
    if (widened) pool = allProps.slice().sort(bySavings);

    const withSavings = pool.filter((b) => b.totals.total_annual_savings > 0);

    if (pool.length === 1) {
      selectedUarn = pool[0].uarn;
    } else if (withSavings.length === 1) {
      selectedUarn = withSavings[0].uarn;
    } else {
      const label = widened ? "" : effectiveSector ? `${effectiveSector} ` : "";
      return {
        step: "pick_property",
        properties: pool,
        ch_profile: chProfile,
        ch_verification: chVerification,
        ch_note: chNote,
        sic_codes: sicCodes,
        company_age_years: companyAgeYears,
        biz_name: bizName,
        postcode,
        sector: effectiveSector,
        reason: `Found ${pool.length} ${label}premises at ${postcode} — which is yours?`,
      };
    }
  }

  // ── 4. Full analysis on selected property ────────────────────────────────────
  let prop = allProps.find((b) => b.uarn === selectedUarn);
  if (!prop) {
    return { step: "error", error: `Property not found at ${postcode} — try again`, status: 404 };
  }
  if (effectiveSector && effectiveSector !== prop.sector) {
    prop = applySectorOverride(prop, effectiveSector);
  }

  const grants = matchGrants({
    sector: prop.sector,
    sic_codes: sicCodes,
    borough: prop.borough,
    rateable_value: prop.rateable_value,
    company_age_years: companyAgeYears,
    company_type: companyType,
    company_name: bizName,
  });

  const council = await boroughContact((prop.borough || "").toLowerCase());

  return {
    step: "analysis",
    property: prop,
    biz_name: bizName,
    ch_profile: chProfile,
    ch_verification: chVerification,
    ch_note: chNote,
    sic_codes: sicCodes,
    company_age_years: companyAgeYears,
    grants,
    lsoa: voaResult.lsoa,
    council,
  };
}
