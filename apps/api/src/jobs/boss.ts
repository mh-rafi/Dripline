import { PgBoss } from "pg-boss";
import type { Config } from "../config.js";

export const QUEUES = {
  CAMPAIGN_SCAN: "campaign.scan",
  CAMPAIGN_DISPATCH_BATCH: "campaign.dispatch-batch",
  AUTOMATION_SCAN: "automation.scan",
  AUTOMATION_STEP: "automation.step",
  BOUNCE_SCAN: "bounce.scan",
  BOUNCE_SCAN_CONNECTION: "bounce.scan-connection",
} as const;

/** Queues retired by the automations v2 rewrite. An install created before it
 * still has their cron schedules in pg-boss, which would keep enqueueing jobs
 * no worker consumes. */
const RETIRED_QUEUES = ["workflow.scan", "workflow.step", "workflow.events-scan"];

export async function createBoss(config: Config): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on("error", (err) => {
    console.error("pg-boss error", err);
  });
  await boss.start();

  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue);
  }

  for (const queue of RETIRED_QUEUES) {
    // Both are no-ops on a fresh install that never had these queues.
    await boss.unschedule(queue).catch(() => {});
    await boss.deleteQueue(queue).catch(() => {});
  }

  return boss;
}
