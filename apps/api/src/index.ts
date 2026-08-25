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
  registerAutomationScanWorker,
  registerAutomationStepWorker,
  scheduleAutomationScan,
} from "./jobs/automationEngine.js";
import {
  registerBounceScanConnectionWorker,
  registerBounceScanWorker,
  scheduleBounceScan,
} from "./jobs/bounceScan.js";

const config = loadConfig();
const pool = createPool(config);
const db = createKysely(pool);

const boss = await createBoss(config);
await registerCampaignScanWorker(boss, db);
await registerCampaignDispatchWorker(boss, db, config);
await registerAutomationScanWorker(boss, db);
await registerAutomationStepWorker(boss, db, config);
await registerBounceScanWorker(boss, db);
await registerBounceScanConnectionWorker(boss, db);
await scheduleCampaignScan(boss);
await scheduleAutomationScan(boss);
await scheduleBounceScan(boss);

const app = buildApp(pool, db, config);

app.listen({ port: config.port, host: config.host }).catch((err) => {
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
