# Data

Stella's deterministic engine reads four Postgres tables. This directory holds
everything you need to fill them, plus one deliberate exclusion.

## What is here

| Path | Size | Rows | Loads into |
|---|---|---|---|
| `seed/companies_house.csv.gz` | 6.8M | 172,320 | `companies_house` |
| `seed/voa_properties.csv.gz` | 6.2M | 311,417 | `voa_properties` |
| `seed/lookups.csv.gz` | 30K | 126 | `lookups` |
| `seed/borough_contacts.csv.gz` | 1.2K | 34 | `borough_contacts` |
| `voa_london_index.csv` | 41M | 311,417 | source of truth for the VOA seed |

`seed/` is the post-filter output of the full pipeline. It lets you run the
product without the 3.1G download described below.

## What is NOT here, and why

`data/BasicCompanyDataAsOneFile-*.csv` and its `.zip` are excluded on purpose.
The CSV is 2.6G and the zip is 471M. GitHub rejects any file over 100MB, and the
Git LFS free tier is 1G, so neither can hold the file. `.gitignore` blocks both
patterns.

Download it from <http://download.companieshouse.gov.uk/en_output.html>.

The snapshot this repository was built against is
**`BasicCompanyDataAsOneFile-2026-06-01`**. Companies House replaces the bulk
file every month and does not keep old ones, so a later download gives different
row counts. Name the date in any result you publish.

Pipeline: 5.6M national rows, filter to London postcodes and active companies,
172,320 rows land in `seed/companies_house.csv.gz`.

## Loading

Create the schema first.

    psql "$DATABASE_URL" -f supabase/migrations/0001_init.sql

Then load the seed files. Each is plain CSV with a header row.

    gzcat data/seed/companies_house.csv.gz | psql "$DATABASE_URL" \
      -c "\copy companies_house FROM STDIN CSV HEADER"
    gzcat data/seed/voa_properties.csv.gz | psql "$DATABASE_URL" \
      -c "\copy voa_properties FROM STDIN CSV HEADER"
    gzcat data/seed/lookups.csv.gz | psql "$DATABASE_URL" \
      -c "\copy lookups FROM STDIN CSV HEADER"
    gzcat data/seed/borough_contacts.csv.gz | psql "$DATABASE_URL" \
      -c "\copy borough_contacts FROM STDIN CSV HEADER"

The `npm run load:*` scripts do **not** read these files. They parse the raw
Companies House CSV and the raw VOA index, and they are the right tool only when
you rebuild the seed from a fresh monthly download.

## Licence

Companies House bulk data and VOA rating list data are both published under the
Open Government Licence v3.0. Redistribution is permitted with attribution.
