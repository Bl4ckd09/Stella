/**
 * Load Companies House bulk data (~5.6M rows) into Postgres via COPY.
 *
 * Download the free snapshot from:
 *   http://download.companieshouse.gov.uk/en_output.html
 *   → BasicCompanyDataAsOneFile-YYYY-MM-DD.zip   (then unzip to .csv)
 *
 * Usage: npm run load:companies  path/to/BasicCompanyDataAsOneFile-YYYY-MM-DD.csv
 *
 * The CH CSV has 50+ columns; we transform each row to the 8-column subset that
 * companies_house stores (postcode_norm is generated and excluded), streaming
 * straight into a COPY pipe so memory stays flat.
 */
import { createReadStream } from "node:fs";
import { parse } from "csv-parse";
import { from as copyFrom } from "pg-copy-streams";
import { makePool } from "./pgpool";

const CSV = process.argv[2];
if (!CSV) {
  console.error("Usage: npm run load:companies <BasicCompanyDataAsOneFile-*.csv>");
  process.exit(1);
}

// CH bulk CSV column names (header present; some have leading spaces — trimmed below).
const COL = {
  name: "CompanyName",
  number: "CompanyNumber",
  postcode: "RegAddress.PostCode",
  status: "CompanyStatus",
  created: "IncorporationDate",
  sic1: "SICCode.SicText_1",
  sic2: "SICCode.SicText_2",
  addr1: "RegAddress.AddressLine1",
  addr2: "RegAddress.AddressLine2",
  town: "RegAddress.PostTown",
};

/** Escape a value for COPY CSV format. */
function csvCell(v: string): string {
  return `"${v.replace(/"/g, '""')}"`;
}

// Load in committed chunks so each COPY is its own transaction — keeps WAL
// small and recyclable, which a small (Nano) instance disk requires.
const CHUNK_ROWS = Number(process.env.CH_CHUNK_ROWS || 200_000);

async function copyChunk(client: import("pg").PoolClient, lines: string[]): Promise<void> {
  const stream = client.query(
    copyFrom(`copy companies_house
      (company_number, name, postcode, status, date_of_creation, sic1, sic2, address)
      from stdin with (format csv)`),
  );
  for (const line of lines) {
    if (!stream.write(line)) await new Promise((res) => stream.once("drain", res));
  }
  stream.end();
  await new Promise<void>((res, rej) => {
    stream.on("finish", () => res());
    stream.on("error", rej);
  });
}

async function main() {
  const pool = makePool();
  const client = await pool.connect();
  try {
    // The bulk COPY runs for several minutes; lift the per-statement timeout
    // (Supabase sets a default that otherwise cancels the load mid-stream).
    await client.query("set statement_timeout = 0");
    await client.query("set idle_in_transaction_session_timeout = 0");
    console.log("Truncating companies_house; loading London-relevant companies …");
    await client.query("drop table if exists companies_staging"); // clean any prior run
    await client.query("truncate companies_house");

    // Only load companies whose registered postcode matches a VOA London
    // property — that's the functional set the engine can join to a property
    // (a company elsewhere has no London property to match). Keeps the table +
    // trigram index well within the 8 GB disk cap. Build an in-memory postcode
    // set + dedupe company_numbers on the fly (CH AsOneFile has duplicates).
    const voa = await client.query("select distinct postcode_norm from voa_properties where postcode_norm <> ''");
    const voaPostcodes = new Set<string>(voa.rows.map((r) => r.postcode_norm as string));
    console.log(`  ${voaPostcodes.size.toLocaleString()} London postcodes to match against`);
    const seen = new Set<string>();

    const parser = createReadStream(CSV).pipe(
      parse({ columns: (header: string[]) => header.map((h) => h.trim()), skip_empty_lines: true, relax_quotes: true }),
    );

    let count = 0;
    let skipped = 0;
    let chunk: string[] = [];
    for await (const row of parser) {
      const pc = (row[COL.postcode] ?? "").trim().toUpperCase();
      if (!pc || !voaPostcodes.has(pc.replace(/\s+/g, ""))) {
        skipped++;
        continue; // skip rows with no postcode or outside the London VOA set
      }
      const num = (row[COL.number] ?? "").trim();
      if (seen.has(num)) {
        skipped++;
        continue; // dedupe duplicate company_numbers
      }
      seen.add(num);
      const addr = [row[COL.addr1], row[COL.addr2], row[COL.town]]
        .map((x: string) => (x ?? "").trim())
        .filter(Boolean)
        .join(", ");
      chunk.push(
        [
          num,
          (row[COL.name] ?? "").trim(),
          pc,
          (row[COL.status] ?? "").trim().toLowerCase(),
          (row[COL.created] ?? "").trim(),
          (row[COL.sic1] ?? "").trim(),
          (row[COL.sic2] ?? "").trim(),
          addr,
        ]
          .map(csvCell)
          .join(",") + "\n",
      );
      if (chunk.length >= CHUNK_ROWS) {
        await copyChunk(client, chunk);
        count += chunk.length;
        chunk = [];
        console.log(`  ${count.toLocaleString()} rows committed …`);
      }
    }
    if (chunk.length) {
      await copyChunk(client, chunk);
      count += chunk.length;
    }

    const { rows } = await client.query("select count(*)::int as n from companies_house");
    console.log(`Loaded ${rows[0].n.toLocaleString()} London-relevant companies (skipped ${skipped.toLocaleString()} off-postcode/duplicate).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
