import { sql } from "kysely";
import type { PgBoss } from "pg-boss";
import type { DB } from "../db/kysely.js";
import { scanConnectionForBounces } from "../services/bounceScanner.js";
import { QUEUES } from "./boss.js";

interface BounceScanConnectionJob {
  connectionId: number;
}

/** Runs every 5 minutes: enqueues one scan job per connection with bounce
 * scanning enabled, deduped via singletonKey so a slow scan of one mailbox
 * never overlaps with the next tick's job for the *same* connection --
 * different connections still scan concurrently. Mirrors
 * jobs/campaignDispatch.ts's scan/dispatch split exactly. See
 * docs/plan/mailbox_bounce_scanning.md §4. */
export async function scheduleBounceScan(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.BOUNCE_SCAN, "*/5 * * * *");
}

export function registerBounceScanWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work(QUEUES.BOUNCE_SCAN, async () => {
    const enabled = await db
      .selectFrom("connections")
      .select("id")
      .where("enabled", "=", true)
      .where(sql<boolean>`bounce_config ->> 'enabled' = 'true'`)
      .execute();
    for (const { id } of enabled) {
      await boss.send(
        QUEUES.BOUNCE_SCAN_CONNECTION,
        { connectionId: id } satisfies BounceScanConnectionJob,
        { singletonKey: `bounce-scan-${id}`, singletonSeconds: 290 },
      );
    }
  });
}

export function registerBounceScanConnectionWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work<BounceScanConnectionJob>(QUEUES.BOUNCE_SCAN_CONNECTION, async ([job]) => {
    if (!job) return;
    await scanConnectionForBounces(db, job.data.connectionId);
  });
}
