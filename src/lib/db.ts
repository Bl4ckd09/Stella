/**
 * Postgres data-access layer (Supabase).
 *
 * Uses a direct `pg` Pool for the read-heavy lookup queries (VOA + Companies
 * House) because they rely on pg_trgm and generated normalised columns that are
 * cleanest expressed as raw SQL. The Supabase JS client is used elsewhere for
 * auth / RLS-bound writes.
 *
 * This module is server-only (imported from route handlers and scripts).
 */
import { Pool } from "pg";

let _pool: Pool | null = null;

export function pool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — cannot connect to Postgres");
  }
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  _pool = new Pool({
    connectionString,
    max: 5,
    // Supabase requires SSL; local dev Postgres does not support it.
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
  return _pool;
}

export function normPostcode(pc: string): string {
  return pc.trim().toUpperCase().replace(/\s+/g, "");
}

export interface VoaRow {
  uarn: string;
  ba_code: string | null;
  borough: string | null;
  desc_code: string | null;
  desc_text: string | null;
  sector: string | null;
  rateable_value: number;
  composite: boolean;
  address: string | null;
  postcode: string | null;
  scat: string | null;
}

/** All VOA properties at a postcode (exact, normalised). */
export async function voaByPostcode(postcode: string): Promise<VoaRow[]> {
  const { rows } = await pool().query<VoaRow>(
    `select uarn, ba_code, borough, desc_code, desc_text, sector,
            rateable_value, composite, address, postcode, scat
       from voa_properties
      where postcode_norm = $1
      order by rateable_value asc`,
    [normPostcode(postcode)],
  );
  return rows;
}

export interface CompanyRow {
  company_number: string;
  name: string;
  postcode: string | null;
  status: string | null;
  date_of_creation: string | null;
  sic1: string | null;
  sic2: string | null;
  address: string | null;
}

/** Companies House records at a postcode. */
export async function companiesByPostcode(postcode: string, activeOnly = false): Promise<CompanyRow[]> {
  const params: unknown[] = [normPostcode(postcode)];
  let sql = `select company_number, name, postcode, status, date_of_creation, sic1, sic2, address
               from companies_house
              where postcode_norm = $1`;
  if (activeOnly) sql += ` and status = 'active'`;
  const { rows } = await pool().query<CompanyRow>(sql, params);
  return rows;
}

/**
 * Fuzzy company-name search (pg_trgm). Replaces the SQLite FTS5 name index.
 * Returns the best trigram-similar names, with similarity score.
 */
export async function companiesByName(name: string, limit = 10): Promise<(CompanyRow & { similarity: number })[]> {
  const q = name.trim();
  if (!q) return [];
  const { rows } = await pool().query<CompanyRow & { similarity: number }>(
    `select company_number, name, postcode, status, date_of_creation, sic1, sic2, address,
            similarity(name, $1) as similarity
       from companies_house
      where name % $1
      order by similarity desc
      limit $2`,
    [q, limit],
  );
  return rows;
}

export interface BoroughContact {
  borough: string;
  apply_url: string | null;
  email: string | null;
  phone: string | null;
}

export async function boroughContact(borough: string): Promise<BoroughContact | null> {
  const { rows } = await pool().query<BoroughContact>(
    `select borough, apply_url, email, phone from borough_contacts where borough = $1`,
    [borough.trim().toLowerCase()],
  );
  return rows[0] ?? null;
}

/** Persist a lookup (web or phone) for analytics / follow-up. Best-effort. */
export async function logLookup(entry: {
  channel: "web" | "phone";
  query?: string;
  postcode?: string;
  uarn?: string;
  result?: unknown;
}): Promise<void> {
  try {
    await pool().query(
      `insert into lookups (channel, query, postcode, uarn, result)
       values ($1, $2, $3, $4, $5)`,
      [entry.channel, entry.query ?? null, entry.postcode ?? null, entry.uarn ?? null, entry.result ?? null],
    );
  } catch {
    // logging must never break a lookup
  }
}
