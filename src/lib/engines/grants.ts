/**
 * Grant eligibility engine — properly tailored to each business.
 *
 * Ported verbatim from the original Stella `engines/rules_grants.py`.
 * Parity enforced by test/grants.parity.test.ts.
 *
 * Rules:
 * - Only show a grant if there's a GENUINE specific reason for this business
 * - Generic "available to everyone" grants are shown with actual company data
 * - Ineligible grants are never shown
 * - match_reasons always reference actual company data (age, SIC, borough, RV)
 */

export type Eligibility = "eligible" | "likely" | "check";

export interface GrantMatch {
  name: string;
  funder: string;
  value: string;
  eligibility: Eligibility;
  match_reasons: string[];
  blockers: string[];
  action: string;
  url: string;
  deadline: string;
}

function fmt0(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

function age0(age: number): string {
  return age.toFixed(0);
}

function title(s: string): string {
  // Python str.title(): capitalise first letter of each word.
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── SIC helpers ──────────────────────────────────────────────────────────────

function sicIn(codes: string[], ...prefixes: string[]): boolean {
  for (const c of codes) {
    const num = c.split(/\s+/)[0]?.trim() ?? "";
    if (prefixes.some((p) => num.startsWith(p))) return true;
  }
  return false;
}

const isTech = (c: string[]) => sicIn(c, "62", "63", "26", "27", "72", "58");
const isCreative = (c: string[]) => sicIn(c, "59", "60", "90", "91", "74", "73");
const isMfg = (c: string[]) =>
  sicIn(c, "10", "11", "12", "13", "14", "15", "16", "17", "18", "20", "21", "22",
    "23", "24", "25", "26", "27", "28", "29", "30", "31", "32", "33");
const isFood = (c: string[]) =>
  sicIn(c, "561", "562", "563", "101", "102", "103", "104", "105", "106", "107", "108", "110");
const isRetail = (c: string[]) => sicIn(c, "47", "46");
const isHealth = (c: string[]) => sicIn(c, "86", "87", "88", "75");
const isRd = (c: string[]) => sicIn(c, "72", "71", "20", "21", "26");

const EAST_LONDON = new Set([
  "hackney", "tower hamlets", "newham", "waltham forest", "barking and dagenham",
  "redbridge", "havering", "lewisham", "greenwich",
]);
const OUTER_LONDON = new Set([
  "barnet", "bexley", "bromley", "croydon", "ealing", "enfield", "harrow", "havering",
  "hillingdon", "hounslow", "kingston upon thames", "merton", "redbridge",
  "richmond upon thames", "sutton", "waltham forest", "barking and dagenham",
]);
const DEPRIVED = new Set([
  "hackney", "tower hamlets", "newham", "barking and dagenham", "haringey",
  "waltham forest", "lewisham", "southwark", "lambeth", "islington",
]);

const east = (b: string) => EAST_LONDON.has(b.toLowerCase());
const outer = (b: string) => OUTER_LONDON.has(b.toLowerCase());
const deprived = (b: string) => DEPRIVED.has(b.toLowerCase());

export interface MatchGrantsInput {
  sector: string;
  sic_codes?: string[] | null;
  borough?: string;
  rateable_value?: number;
  company_age_years?: number | null;
  company_type?: string;
  company_name?: string;
}

export function matchGrants(input: MatchGrantsInput): GrantMatch[] {
  const sic = input.sic_codes ?? [];
  const age = input.company_age_years ?? null;
  const b = (input.borough ?? "").trim().toLowerCase();
  const rv = input.rateable_value ?? 0;
  const s = (input.sector ?? "").toLowerCase();
  const name = input.company_name ?? "";
  const companyType = input.company_type ?? "";
  const borough = input.borough ?? "";
  const results: GrantMatch[] = [];

  // ── 1. Start Up Loan ───────────────────────────────────────────────────────
  if (age === null || age <= 5) {
    const reasons: string[] = [];
    const blockers: string[] = [];
    let elig: Eligibility;
    if (age !== null && age <= 2) {
      reasons.push(`${name || "Your business"} is ${age0(age)} year(s) old well within the startup window`);
      elig = "eligible";
    } else if (age !== null && age <= 5) {
      reasons.push(`At ${age0(age)} years old you may still qualify (British Business Bank considers trading history)`);
      elig = "likely";
    } else {
      reasons.push("Age unconfirmed (worth checking eligibility directly)");
      elig = "check";
    }
    if (rv > 0 && rv < 51000) {
      reasons.push(`RV £${fmt0(rv)} confirms small business scale`);
    }
    results.push({
      name: "Start Up Loan (British Business Bank)",
      funder: "British Business Bank / UK Gov",
      value: "£500–£25,000 at 6% fixed + 12 months free mentoring",
      eligibility: elig,
      match_reasons: reasons,
      blockers,
      action: "Apply at startuploans.co.uk, decision in ~4 weeks",
      url: "https://www.startuploans.co.uk/",
      deadline: "Rolling",
    });
  }

  // ── 2. UKSPF ───────────────────────────────────────────────────────────────
  const ukspfReasons: string[] = [];
  let ukspfElig: Eligibility | null = null;
  if (deprived(b)) {
    ukspfReasons.push(`${borough} is a UKSPF priority borough (higher allocation)`);
    ukspfElig = "eligible";
  }
  if (outer(b) && ukspfReasons.length === 0) {
    ukspfReasons.push(`${borough} is an outer London priority area for UKSPF business support`);
    ukspfElig = "likely";
  }
  if (["cafe", "pub", "hospitality", "retail", "leisure"].includes(s) && rv < 51000) {
    ukspfReasons.push(`${title(s)} sector is a UKSPF high street recovery priority`);
    if (!ukspfElig) ukspfElig = "likely";
  }
  if (rv > 0 && rv < 15000) {
    ukspfReasons.push(`RV £${fmt0(rv)} (micro business scale, UKSPF primary target)`);
    if (!ukspfElig) ukspfElig = "likely";
  }
  if (ukspfReasons.length > 0) {
    results.push({
      name: "UK Shared Prosperity Fund",
      funder: "HM Government via London Borough Councils",
      value: "Up to £25,000 (varies by borough)",
      eligibility: ukspfElig as Eligibility,
      match_reasons: ukspfReasons,
      blockers: [],
      action: `Contact ${borough || "your"} Council economic development team`,
      url: "https://www.gov.uk/government/publications/uk-shared-prosperity-fund-prospectus",
      deadline: "Rolling (borough-dependent)",
    });
  }

  // ── 3. London Growth Hub ─────────────────────────────────────────────────────
  const lghReasons = [`${name || "Your business"} qualifies as a London SME with < 250 employees`];
  if (rv > 0 && rv < 51000) {
    lghReasons.push(`RV £${fmt0(rv)} confirms SME scale (advisers will match further grants)`);
  }
  if (age && age > 2) {
    lghReasons.push(`At ${age0(age)} years trading, growth advisory is the most relevant entry point`);
  }
  results.push({
    name: "London Growth Hub: Free Advice + Grant Referral",
    funder: "GLA / Mayor of London",
    value: "Free diagnostics + matched grant referral (£10k–£100k+)",
    eligibility: "eligible",
    match_reasons: lghReasons,
    blockers: [],
    action: "Register at londongrowthub.co.uk (free, no commitment)",
    url: "https://www.londongrowthub.co.uk/",
    deadline: "Rolling",
  });

  // ── 4. Innovate UK ───────────────────────────────────────────────────────────
  if (isTech(sic) || isRd(sic) || isMfg(sic)) {
    const ikReasons: string[] = [];
    if (isTech(sic)) ikReasons.push("SIC codes confirm tech/digital sector (core Innovate UK target)");
    if (isRd(sic)) ikReasons.push("R&D SIC codes confirmed. Directly eligible for innovation funding.");
    if (isMfg(sic)) ikReasons.push("Manufacturing sector. Eligible for product/process innovation grants.");
    const elig: Eligibility = isTech(sic) || isRd(sic) ? "likely" : "check";
    results.push({
      name: "Innovate UK Smart Grants",
      funder: "UK Research & Innovation (UKRI)",
      value: "£25,000–£500,000 (25%–100% match funded)",
      eligibility: elig,
      match_reasons: ikReasons,
      blockers: ["Must demonstrate innovation beyond existing technology"],
      action: "Check open rounds at apply-for-innovation-funding.service.gov.uk",
      url: "https://apply-for-innovation-funding.service.gov.uk/",
      deadline: "Competitive rounds (quarterly)",
    });
  }

  // ── 5. R&D Tax Credits ───────────────────────────────────────────────────────
  if (isTech(sic) || isRd(sic) || isMfg(sic) || isHealth(sic)) {
    const rdReasons: string[] = [];
    const blockers: string[] = [];
    if (isTech(sic)) rdReasons.push("Tech/software development likely qualifies as R&D");
    if (isRd(sic)) rdReasons.push("SIC code confirms research & development activity");
    if (isMfg(sic)) rdReasons.push("Manufacturing process improvement often qualifies as R&D");
    if (isHealth(sic)) rdReasons.push("Healthcare/science sector. Clinical R&D typically qualifies.");
    rdReasons.push("If you've built anything new or solved a technical problem, R&D credits likely apply");
    if (!["ltd", "plc", "limited", "private limited company", ""].includes(companyType.toLowerCase())) {
      blockers.push(`Company type '${companyType}' (must be Ltd/PLC to claim)`);
    }
    results.push({
      name: "R&D Tax Credits (HMRC)",
      funder: "HMRC",
      value: "Up to 33p per £1 spent on R&D",
      eligibility: blockers.length === 0 ? "likely" : "check",
      match_reasons: rdReasons,
      blockers,
      action: "Claim via Corporation Tax return — specialist accountant recommended",
      url: "https://www.gov.uk/guidance/corporation-tax-research-and-development-rd-relief",
      deadline: "2 years after accounting period end",
    });
  }

  // ── 6. GLA Good Growth Fund ──────────────────────────────────────────────────
  const ggReasons: string[] = [];
  let ggElig: Eligibility | null = null;
  if (isCreative(sic)) {
    ggReasons.push("Creative/cultural sector is a primary GLA Good Growth Fund target");
    ggElig = "likely";
  }
  if (east(b) || deprived(b)) {
    ggReasons.push(`${borough} is a GLA priority area for inclusive growth investment`);
    ggElig = ggElig === "likely" ? "eligible" : "likely";
  }
  if (["leisure", "hospitality"].includes(s) && deprived(b)) {
    ggReasons.push(`Community leisure/hospitality in ${borough} — strong fit for Good Growth criteria`);
    if (!ggElig) ggElig = "likely";
  }
  if (ggReasons.length > 0) {
    results.push({
      name: "GLA Good Growth Fund",
      funder: "Greater London Authority (Mayor of London)",
      value: "£100,000–£2,000,000",
      eligibility: ggElig as Eligibility,
      match_reasons: ggReasons,
      blockers: ["Must demonstrate community/cultural benefit — not purely commercial"],
      action: "Check open rounds at london.gov.uk/good-growth-fund",
      url: "https://www.london.gov.uk/programmes-strategies/arts-culture/funding",
      deadline: "Competitive — check for open rounds",
    });
  }

  // ── 7. Hospitality Energy Grant ──────────────────────────────────────────────
  if (["cafe", "pub", "hospitality"].includes(s) || isFood(sic)) {
    const energyReasons = [`${title(s)} sector is the explicit target of this energy grant`];
    if (s === "cafe") energyReasons.push("High energy use in espresso machines, refrigeration, and cooking");
    else if (s === "pub") energyReasons.push("Draught systems, cellar cooling, and kitchen energy costs qualify");
    else if (s === "hospitality") energyReasons.push("Commercial kitchen and HVAC costs are primary qualifying expenses");
    if (rv < 51000) {
      energyReasons.push(`RV £${fmt0(rv)} — small venue scale, typical target for this scheme`);
    }
    results.push({
      name: "Hospitality Sector Energy Efficiency Grant",
      funder: "London boroughs + DESNZ",
      value: "Up to £5,000 (varies by borough)",
      eligibility: "likely",
      match_reasons: energyReasons,
      blockers: ["Borough-specific — availability varies, check your council"],
      action: `Contact ${borough || "your"} borough council sustainability team`,
      url: "https://www.find-government-grants.service.gov.uk/",
      deadline: "Rolling",
    });
  }

  // ── 8. East London Business Place ────────────────────────────────────────────
  if (east(b)) {
    results.push({
      name: "East London Business Place (ELBP) Grant",
      funder: "ELBP / GLA",
      value: "Up to £10,000 + free mentoring",
      eligibility: "eligible",
      match_reasons: [
        `${borough} is within ELBP's priority catchment area`,
        "Direct grant for local SMEs — no match funding required",
        `${name || "Your business"} qualifies based on location alone`,
      ],
      blockers: [],
      action: "Apply directly at elbp.co.uk",
      url: "https://elbp.co.uk/",
      deadline: "Rolling",
    });
  }

  // ── 9. Creative Enterprise Programme ─────────────────────────────────────────
  if (isCreative(sic) || s === "leisure") {
    results.push({
      name: "Creative Enterprise Programme",
      funder: "Arts Council England + GLA",
      value: "£2,500–£15,000 + free business support",
      eligibility: "likely",
      match_reasons: [
        isCreative(sic) ? "Creative/cultural SIC codes confirmed" : `${title(s)} sector with cultural dimension`,
        "Programme specifically targets London creative SMEs",
      ],
      blockers: ["Must have cultural/creative mission — not purely commercial"],
      action: "Check artscouncil.org.uk for open rounds",
      url: "https://www.artscouncil.org.uk/funding",
      deadline: "Competitive rounds",
    });
  }

  // ── 10. Made Smarter ─────────────────────────────────────────────────────────
  if (isMfg(sic) || s === "industrial") {
    results.push({
      name: "Made Smarter — Digital Adoption Grant",
      funder: "Department for Business and Trade",
      value: "Up to £20,000 (50% match) + free digital audit",
      eligibility: "likely",
      match_reasons: [
        "Manufacturing/industrial sector is the sole target of this programme",
        "Grant covers industrial IoT, automation, and digital manufacturing tools",
        rv > 0 ? `RV £${fmt0(rv)} confirms SME manufacturing scale` : "SME scale qualifies",
      ],
      blockers: ["Must have manufacturing operations in England"],
      action: "Apply via madesmarter.uk/apply",
      url: "https://www.madesmarter.uk/",
      deadline: "Rolling",
    });
  }

  // ── 11. Retail High Streets ──────────────────────────────────────────────────
  if ((isRetail(sic) || s === "retail") && (deprived(b) || outer(b))) {
    results.push({
      name: "High Streets Heritage Action Zone Grant",
      funder: "Historic England + Local Authority",
      value: "£5,000–£50,000 for shopfront/building improvements",
      eligibility: deprived(b) ? "likely" : "check",
      match_reasons: [
        `Retail business in ${borough} — priority area for High Streets programme`,
        "Covers shopfront improvements, signage, accessibility works",
      ],
      blockers: ["Property must be in a designated Heritage Action Zone — check with your council"],
      action: `Contact ${borough} Council planning/regeneration team`,
      url: "https://historicengland.org.uk/services-skills/heritage-action-zones/",
      deadline: "Rolling",
    });
  }

  // ── 12. Net Zero ─────────────────────────────────────────────────────────────
  const nzReasons: string[] = [];
  if (["cafe", "pub", "hospitality", "industrial", "retail"].includes(s)) {
    nzReasons.push(`${title(s)} sector has high energy costs — free audit identifies savings`);
  }
  if (rv > 0) {
    nzReasons.push(`Business premises at RV £${fmt0(rv)} qualifies for commercial energy support`);
  }
  if (b) {
    nzReasons.push(`${borough} Council has a local net zero business programme`);
  }
  results.push({
    name: "Net Zero Business Energy Support",
    funder: "DESNZ / local energy hubs",
    value: "Free energy audit + up to £5,000 for efficiency works",
    eligibility: "check",
    match_reasons: nzReasons.length > 0 ? nzReasons : ["Available to all London SMEs"],
    blockers: ["Varies by borough — contact your local energy hub"],
    action: "Check businessclimatesupport.co.uk or your borough council",
    url: "https://www.businessclimatesupport.co.uk/",
    deadline: "Rolling",
  });

  // ── Sort and return ──────────────────────────────────────────────────────────
  const order: Record<Eligibility, number> = { eligible: 0, likely: 1, check: 2 };
  // Stable sort (matches Python's stable list.sort)
  results.sort((a, c) => order[a.eligibility] - order[c.eligibility]);
  return results;
}
