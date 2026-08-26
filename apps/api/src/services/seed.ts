import type { DB } from "../db/kysely.js";
import { DEFAULT_TEMPLATE_BODY, DEFAULT_TEMPLATE_NAME } from "../lib/defaultTemplate.js";

export interface SeedResult {
  templatesInserted: number;
}

/**
 * Populates a fresh install with the rows it can't usefully start without.
 * Runs on every container start (after migrations), so it has to be a no-op on
 * an install that already has data.
 *
 * Templates are user-editable, so "already seeded" is judged by the table being
 * non-empty rather than by looking for the seeded row: matching on name or
 * is_default would resurrect a template the user deliberately deleted or
 * renamed, and re-inserting would either duplicate it or overwrite their edits.
 */
export async function seed(db: DB): Promise<SeedResult> {
  const existing = await db.selectFrom("templates").select("id").limit(1).executeTakeFirst();
  if (existing) return { templatesInserted: 0 };

  await db
    .insertInto("templates")
    .values({
      name: DEFAULT_TEMPLATE_NAME,
      subject: "",
      body: DEFAULT_TEMPLATE_BODY,
      is_default: true,
    })
    .execute();

  return { templatesInserted: 1 };
}
