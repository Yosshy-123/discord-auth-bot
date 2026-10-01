import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema.js";
import { env } from "../config.js";

// §11.2: direct Postgres connection, TLS required (sslmode=require expected
// in DATABASE_URL). Pool size kept conservative for a single-instance deploy.
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ level: "error", msg: "pg pool error", error: err.message }));
});

export const db = drizzle(pool, { schema });
