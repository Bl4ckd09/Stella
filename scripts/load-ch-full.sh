#!/usr/bin/env bash
# Full Companies House pipeline: download → unzip → load 5.6M rows to Supabase.
# Drops the GIN trigram index before the bulk COPY and rebuilds it after
# (far faster + lighter on a small instance than maintaining it row-by-row).
set -euo pipefail
cd "$(dirname "$0")/.."

DATA=data
ZIP="$DATA/BasicCompanyDataAsOneFile-2026-06-01.zip"
CSV="$DATA/BasicCompanyDataAsOneFile-2026-06-01.csv"
URL="https://download.companieshouse.gov.uk/BasicCompanyDataAsOneFile-2026-06-01.zip"

# DATABASE_URL comes from .env.local (never hardcode credentials).
set -a; [ -f .env.local ] && . ./.env.local; set +a
PG="${DATABASE_URL:?DATABASE_URL not set — add it to .env.local}"
export PGSSLMODE=require

echo "[1/5] Downloading ($(date))…"
[ -f "$ZIP" ] || curl -fsS -o "$ZIP" "$URL"
echo "  zip: $(ls -lh "$ZIP" | awk '{print $5}')"

echo "[2/5] Unzipping…"
[ -f "$CSV" ] || unzip -o -q "$ZIP" -d "$DATA"
echo "  csv: $(ls -lh "$DATA"/BasicCompanyDataAsOneFile-2026-06-01.csv | awk '{print $5}')"

echo "[3/5] Dropping trigram index for fast bulk load…"
psql "$PG" -c "drop index if exists idx_ch_name_trgm;"

echo "[4/5] Loading rows via streaming COPY ($(date))…"
npx tsx scripts/load-companies.ts "$CSV"

echo "[5/5] Rebuilding trigram index ($(date))…"
psql "$PG" -c "create index if not exists idx_ch_name_trgm on companies_house using gin (name gin_trgm_ops);"
psql "$PG" -c "select count(*) as companies_loaded from companies_house;"
echo "DONE ($(date))"
