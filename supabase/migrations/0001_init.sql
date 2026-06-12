-- Stella schema — VOA rating list + Companies House + borough contacts.
-- Replaces the original SQLite (ch_index.db) + voa_london_index.csv data layer.
--
-- Run via: supabase db push   (or psql "$DATABASE_URL" -f this file)

-- Fuzzy business-name matching (replaces SQLite FTS5).
create extension if not exists pg_trgm;

-- ── VOA 2026 rating list (London) ────────────────────────────────────────────
-- One row per rateable property. ~311k London rows.
create table if not exists voa_properties (
  uarn            text primary key,
  ba_code         text,
  borough         text,
  desc_code       text,
  desc_text       text,
  sector          text,
  rateable_value  double precision not null,
  composite       boolean default false,
  address         text,
  postcode        text,
  -- normalised postcode (UPPER, no spaces) for exact lookup, matching the
  -- Python _norm_postcode() used by the relief pipeline.
  postcode_norm   text generated always as (upper(replace(coalesce(postcode,''), ' ', ''))) stored,
  scat            text
);

create index if not exists idx_voa_postcode_norm on voa_properties (postcode_norm);
create index if not exists idx_voa_borough on voa_properties (lower(borough));
create index if not exists idx_voa_sector on voa_properties (sector);
-- Partial index supports the Priority Scanner (SBRR-eligible properties only).
create index if not exists idx_voa_sbrr_eligible on voa_properties (borough)
  where rateable_value > 0 and rateable_value <= 15000;

-- ── Companies House bulk data ────────────────────────────────────────────────
-- ~5.6M UK companies. Loaded from BasicCompanyDataAsOneFile-*.zip.
create table if not exists companies_house (
  company_number    text primary key,
  name              text not null,
  postcode          text,
  postcode_norm     text generated always as (upper(replace(coalesce(postcode,''), ' ', ''))) stored,
  status            text,
  date_of_creation  text,
  sic1              text,
  sic2              text,
  address           text
);

create index if not exists idx_ch_postcode_norm on companies_house (postcode_norm);
-- Trigram index for fuzzy / prefix name search (the FTS5 replacement).
create index if not exists idx_ch_name_trgm on companies_house using gin (name gin_trgm_ops);

-- ── London borough business-rates contacts ───────────────────────────────────
create table if not exists borough_contacts (
  borough    text primary key,   -- lowercased borough name
  apply_url  text,
  email      text,
  phone      text
);

-- ── Optional: persist claims & call logs for the web/phone product ───────────
create table if not exists lookups (
  id          bigint generated always as identity primary key,
  created_at  timestamptz default now(),
  channel     text not null,            -- 'web' | 'phone'
  query       text,
  postcode    text,
  uarn        text,
  result      jsonb
);
create index if not exists idx_lookups_created on lookups (created_at desc);
