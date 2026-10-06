/** Applies pending migrations: `DATABASE_URL=… pnpm --filter @stele/db migrate`. */
import { migrateDb } from "./index";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(64);
}
await migrateDb(url);
console.info("migrations applied");
