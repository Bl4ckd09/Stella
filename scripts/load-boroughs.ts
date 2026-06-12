/**
 * Load the 33 London borough business-rates contacts into Postgres.
 * Usage: npm run db:borough
 */
import contacts from "../src/lib/borough_contacts.json";
import { makePool } from "./pgpool";

async function main() {
  const pool = makePool();
  const entries = Object.entries(contacts as Record<string, { apply_url?: string; email?: string; phone?: string }>);
  for (const [borough, c] of entries) {
    await pool.query(
      `insert into borough_contacts (borough, apply_url, email, phone)
       values ($1, $2, $3, $4)
       on conflict (borough) do update set
         apply_url = excluded.apply_url, email = excluded.email, phone = excluded.phone`,
      [borough.toLowerCase(), c.apply_url ?? null, c.email ?? null, c.phone ?? null],
    );
  }
  console.log(`Loaded ${entries.length} borough contacts.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
