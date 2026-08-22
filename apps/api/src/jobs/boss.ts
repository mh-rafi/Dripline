import PgBoss from "pg-boss";
import type { Config } from "../config.js";

export const QUEUES = {
  CAMPAIGN_SCAN: "campaign.scan",
  CAMPAIGN_DISPATCH_BATCH: "campaign.dispatch-batch",
  WORKFLOW_SCAN: "workflow.scan",
  WORKFLOW_STEP: "workflow.step",
  WORKFLOW_EVENTS_SCAN: "workflow.events-scan",
} as const;

export async function createBoss(config: Config): Promise<PgBoss> {
  const boss = new PgBoss({ connectionString: config.databaseUrl });
  boss.on("error", (err) => {
    console.error("pg-boss error", err);
  });
  await boss.start();

  for (const queue of Object.values(QUEUES)) {
    await boss.createQueue(queue);
  }

  return boss;
}
