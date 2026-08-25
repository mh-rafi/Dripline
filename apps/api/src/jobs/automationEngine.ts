import type { PgBoss } from "pg-boss";
import type { DB } from "../db/kysely.js";
import type { Config } from "../config.js";
import { processEnrollmentStep } from "../services/automationRunner.js";
import { QUEUES } from "./boss.js";

interface StepJob {
  enrollmentId: string;
}

export async function scheduleAutomationScan(boss: PgBoss): Promise<void> {
  await boss.schedule(QUEUES.AUTOMATION_SCAN, "*/1 * * * *");
}

export function registerAutomationScanWorker(boss: PgBoss, db: DB): Promise<string> {
  return boss.work(QUEUES.AUTOMATION_SCAN, async () => {
    const due = await db
      .selectFrom("automation_enrollments")
      .select("id")
      .where("status", "=", "active")
      .where(({ or, eb }) =>
        or([eb("next_run_at", "is", null), eb("next_run_at", "<=", new Date())]),
      )
      .limit(1000)
      .execute();

    for (const { id } of due) {
      await boss.send(QUEUES.AUTOMATION_STEP, { enrollmentId: id } satisfies StepJob, {
        // One in-flight step per enrollment: the scan runs every minute, so a
        // step still queued from the previous tick must not be duplicated.
        singletonKey: `enrollment-${id}`,
        singletonSeconds: 55,
      });
    }
  });
}

export function registerAutomationStepWorker(
  boss: PgBoss,
  db: DB,
  config: Config,
): Promise<string> {
  return boss.work<StepJob>(QUEUES.AUTOMATION_STEP, async ([job]) => {
    if (!job) return;
    await processEnrollmentStep(db, config, job.data.enrollmentId);
  });
}
