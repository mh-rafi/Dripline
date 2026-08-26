// Standalone entry point: `npm run seed`, and the step deploy/entrypoint.sh
// runs after migrations. Separate from index.ts so seeding does not depend on
// booting the workers and the HTTP server.
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createKysely } from "./db/kysely.js";
import { seed } from "./services/seed.js";

const config = loadConfig();
const pool = createPool(config);
const db = createKysely(pool);

try {
  const result = await seed(db);
  console.log(
    result.templatesInserted > 0
      ? `dripline: seeded ${result.templatesInserted} template(s)`
      : "dripline: nothing to seed",
  );
} finally {
  await pool.end();
}
