-- Enable Row Level Security on every public table.
--
-- Stella's app reads/writes via the direct Postgres connection (pg Pool, the
-- `postgres` role) which BYPASSES RLS — so enabling deny-all RLS here does not
-- affect the application. It only closes the auto-generated PostgREST/anon-key
-- API surface, which we never use.
--
-- With RLS enabled and NO policies, the anon/authenticated roles get deny-all.
-- Reference tables (VOA, Companies House, boroughs) are public UK open data, so
-- we *could* expose read-only later if the browser ever needs direct access —
-- but the app goes through Next.js route handlers, so we leave them closed.
-- `lookups` records user queries and must stay server-only (deny-all).

alter table public.companies_house  enable row level security;
alter table public.voa_properties   enable row level security;
alter table public.borough_contacts enable row level security;
alter table public.lookups          enable row level security;

-- (Intentionally no policies — deny-all through the anon/public API.)
-- If you later want the browser to read reference data with the anon key:
--   create policy "public read" on public.voa_properties for select to anon using (true);
-- Do NOT add such a policy to public.lookups.
