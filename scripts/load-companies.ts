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
    console.log(`Truncating companies_house; loading in ${CHUNK_ROWS.toLocaleString()}-row chunks …`);
    await client.query("truncate companies_house");

    const parser = createReadStream(CSV).pipe(
      parse({ columns: (header: string[]) => header.map((h) => h.trim()), skip_empty_lines: true, relax_quotes: true }),
    );

    let count = 0;
    let skipped = 0;
    let chunk: string[] = [];
    for await (const row of parser) {
      const pc = (row[COL.postcode] ?? "").trim().toUpperCase();
      if (!pc) {
        skipped++;
        continue; // matches original: skip rows with no postcode
      }
      const addr = [row[COL.addr1], row[COL.addr2], row[COL.town]]
        .map((x: string) => (x ?? "").trim())
        .filter(Boolean)
        .join(", ");
      chunk.push(
        [
          (row[COL.number] ?? "").trim(),
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
    console.log(`Loaded ${rows[0].n.toLocaleString()} companies (skipped ${skipped.toLocaleString()} with no postcode).`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
