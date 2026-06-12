/**
 * Load the VOA London rating list (data/voa_london_index.csv, ~311k rows) into
 * Postgres via COPY. The CSV column order maps directly to voa_properties
 * (postcode_norm is a generated column and is excluded).
 *
 * Usage: npm run load:voa  [path/to/voa.csv]
 */
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { from as copyFrom } from "pg-copy-streams";
import { makePool } from "./pgpool";

const CSV = process.argv[2] || path.join(process.cwd(), "data", "voa_london_index.csv");

async function main() {
  const pool = makePool();
  const client = await pool.connect();
  try {
    console.log(`Truncating voa_properties and loading from ${CSV} …`);
    await client.query("truncate voa_properties");
    // Stage into an unlogged table (no PK) so duplicate UARNs in the source CSV
    // don't abort the COPY; then dedupe on the way into the real table.
    await client.query("drop table if exists voa_staging");
    await client.query(`create unlogged table voa_staging (
      ba_code text, borough text, uarn text, desc_code text, desc_text text, sector text,
      rateable_value double precision, composite boolean, address text, postcode text, scat text)`);
    const ingest = client.query(
      copyFrom(`copy voa_staging
        (ba_code, borough, uarn, desc_code, desc_text, sector, rateable_value, composite, address, postcode, scat)
        from stdin with (format csv, header true)`),
    );
    await pipeline(createReadStream(CSV), ingest);
    const staged = await client.query("select count(*)::int as n from voa_staging");
    await client.query(`insert into voa_properties
      (ba_code, borough, uarn, desc_code, desc_text, sector, rateable_value, composite, address, postcode, scat)
      select distinct on (uarn)
        ba_code, borough, uarn, desc_code, desc_text, sector, rateable_value, composite, address, postcode, scat
      from voa_staging
      order by uarn
      on conflict (uarn) do nothing`);
    await client.query("drop table voa_staging");
    const { rows } = await client.query("select count(*)::int as n from voa_properties");
    console.log(`Staged ${staged.rows[0].n.toLocaleString()} rows → loaded ${rows[0].n.toLocaleString()} unique VOA properties.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
