import type PgBoss from "pg-boss";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { processEnrollmentStep, processEventsScan } from "../services/workflows.js";
import { QUEUES } from "./boss.js";

interface StepJob {
  enrollmentId: string;
}

export async function scheduleWorkflowScans(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.WORKFLOW_SCAN, "*/1 * * * *");
  await boss.schedule(QUEUES.WORKFLOW_EVENTS_SCAN, "*/1 * * * *");
}

export function registerWorkflowScanWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work(QUEUES.WORKFLOW_SCAN, async () => {
    const due = await db
      .selectFrom("workflow_enrollments")
      .select("id")
      .where("status", "=", "active")
      .where(({ or, eb }) =>
        or([eb("next_run_at", "is", null), eb("next_run_at", "<=", new Date())]),
      )
      .limit(1000)
      .execute();

    for (const { id } of due) {
      await boss.send(QUEUES.WORKFLOW_STEP, { enrollmentId: id } satisfies StepJob, {
        singletonKey: `enrollment-${id}`,
        singletonSeconds: 55,
      });
    }
  });
}

export function registerWorkflowStepWorker(boss: PgBoss, db: DB, config: Config): Promise<string> {
  return boss.work<StepJob>(QUEUES.WORKFLOW_STEP, async ([job]) => {
    if (!job) return;
    await processEnrollmentStep(db, config, job.data.enrollmentId);
  });
}

export function registerWorkflowEventsWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work(QUEUES.WORKFLOW_EVENTS_SCAN, async () => {
    await processEventsScan(db);
  });
}
