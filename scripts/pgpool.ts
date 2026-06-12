/** Shared Postgres pool factory for the loader scripts. Loads .env.local. */
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });

export function makePool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set (.env.local)");
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  return new Pool({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}
