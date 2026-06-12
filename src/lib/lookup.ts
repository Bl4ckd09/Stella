/**
 * End-to-end lookup pipeline: postcode or business name → structured relief findings.
 * Ported from agent/pipeline.py — preserves the frozen JSON contract that the
 * frontend and the ElevenLabs voice agent both build against.
 *
 * LLM BOUNDARY: this module outputs structured data only. The LLM never
 * computes or modifies monetary values.
 */
import { assess, grossBill, totals, type Business, type ReliefFinding, type Totals } from "./engines/relief";
import { voaByPostcode, companiesByName, type VoaRow } from "./db";

export interface BusinessResult {
  uarn: string;
  name: string;
  address: string;
  postcode: string;
  borough: string;
  sector: string;
  rateable_value: number;
  gross_annual_bill: number;
  findings: ReliefFinding[];
  totals: Totals;
}

export interface LookupResult {
  query: string;
  query_type: "postcode" | "name";
  businesses: BusinessResult[];
  lsoa: string | null;
  error: string | null;
  candidates?: { name: string; postcode: string; company_number: string }[];
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function buildBusiness(m: VoaRow): BusinessResult {
  const rv = m.rateable_value;
  const sector = m.sector || "other";
  const biz: Business = {
    name: m.desc_text || "",
    rateable_value: rv,
    borough: m.borough || "",
    sector,
    uarn: m.uarn || "",
    address: m.address || "",
    postcode: m.postcode || "",
    composite: m.composite || false,
  };
  const findings = assess(biz);
  return {
    uarn: biz.uarn!,
    name: biz.name,
    address: biz.address!,
    postcode: biz.postcode!,
    borough: biz.borough,
    sector: biz.sector,
    rateable_value: rv,
    gross_annual_bill: round2(grossBill(rv, sector)),
    findings,
    totals: totals(findings),
  };
}

/** Best-effort LSOA enrichment via postcodes.io (free, no auth). */
async function resolveLsoa(postcode: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.result?.lsoa ?? data?.result?.codes?.lsoa ?? null;
  } catch {
    return null;
  }
}

async function buildResult(
  query: string,
  queryType: "postcode" | "name",
  matches: VoaRow[],
  postcode: string,
): Promise<LookupResult> {
  const businesses = matches.map(buildBusiness);
  const lsoa = postcode ? await resolveLsoa(postcode) : null;
  return {
    query,
    query_type: queryType,
    businesses,
    lsoa,
    error: businesses.length ? null : "no_voa_entry_found",
  };
}

/** Postcode → VOA entries → relief findings. */
export async function run(postcode: string): Promise<LookupResult> {
  const matches = await voaByPostcode(postcode);
  return buildResult(postcode, "postcode", matches, postcode);
}

/**
 * Business name → Companies House (local fuzzy) → postcode → VOA → relief findings.
 * Tries each candidate postcode until VOA entries are found.
 */
export async function runByName(name: string): Promise<LookupResult> {
  let candidates: Awaited<ReturnType<typeof companiesByName>>;
  try {
    candidates = await companiesByName(name, 10);
  } catch (exc) {
    return { query: name, query_type: "name", businesses: [], lsoa: null, error: `companies_house_error: ${exc}` };
  }
  if (!candidates.length) {
    return { query: name, query_type: "name", businesses: [], lsoa: null, error: "no_companies_house_match" };
  }
  for (const c of candidates) {
    const pc = c.postcode ?? "";
    if (!pc) continue;
    const matches = await voaByPostcode(pc);
    if (matches.length) return buildResult(name, "name", matches, pc);
  }
  return {
    query: name,
    query_type: "name",
    businesses: [],
    lsoa: null,
    error: "no_voa_entry_found",
    candidates: candidates.map((c) => ({
      name: c.name,
      postcode: c.postcode ?? "",
      company_number: c.company_number,
    })),
  };
}

const POSTCODE_RE = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2}$/i;

export function isPostcode(query: string): boolean {
  return POSTCODE_RE.test(query.trim());
}
