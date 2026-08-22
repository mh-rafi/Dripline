import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { createKysely } from "./db/kysely.js";
import { createBoss } from "./jobs/boss.js";
import {
  registerCampaignDispatchWorker,
  registerCampaignScanWorker,
  scheduleCampaignScan,
} from "./jobs/campaignDispatch.js";
import {
  registerWorkflowEventsWorker,
  registerWorkflowScanWorker,
  registerWorkflowStepWorker,
  scheduleWorkflowScans,
} from "./jobs/workflowEngine.js";

const config = loadConfig();
const pool = createPool(config);
const db = createKysely(pool);

const boss = await createBoss(config);
await registerCampaignScanWorker(boss, db);
await registerCampaignDispatchWorker(boss, db, config);
await registerWorkflowScanWorker(boss, db);
await registerWorkflowStepWorker(boss, db, config);
await registerWorkflowEventsWorker(boss, db);
await scheduleCampaignScan(boss);
await scheduleWorkflowScans(boss);

const app = buildApp(pool, db, config);

app.listen({ port: config.port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await boss.stop();
    await pool.end();
    process.exit(0);
  });
}
