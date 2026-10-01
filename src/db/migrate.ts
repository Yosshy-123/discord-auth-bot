import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./client.js";

async function main() {
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  // eslint-disable-next-line no-console
  console.log("migrations applied");
  await pool.end();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("migration failed", err);
  process.exit(1);
});
