import { sql } from "kysely";
import type { PgBoss } from "pg-boss";
import type { DB } from "../db/kysely.js";
import { pollConnectionForBounces } from "../services/bouncePoller.js";
import { QUEUES } from "./boss.js";

interface BouncePollConnectionJob {
  connectionId: number;
}

/** Same scan/per-connection split as jobs/bounceScan.ts: one job per
 * connection with API polling enabled, deduped so a slow provider API never
 * overlaps the next tick's job for the same connection. */
export async function scheduleBouncePoll(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.BOUNCE_POLL, "*/5 * * * *");
}

export function registerBouncePollWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work(QUEUES.BOUNCE_POLL, async () => {
    const enabled = await db
      .selectFrom("connections")
      .select("id")
      .where("enabled", "=", true)
      .where(sql<boolean>`bounce_poll_config ->> 'enabled' = 'true'`)
      .execute();
    for (const { id } of enabled) {
      await boss.send(
        QUEUES.BOUNCE_POLL_CONNECTION,
        { connectionId: id } satisfies BouncePollConnectionJob,
        { singletonKey: `bounce-poll-${id}`, singletonSeconds: 290 },
      );
    }
  });
}

export function registerBouncePollConnectionWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work<BouncePollConnectionJob>(QUEUES.BOUNCE_POLL_CONNECTION, async ([job]) => {
    if (!job) return;
    await pollConnectionForBounces(db, job.data.connectionId);
  });
}
