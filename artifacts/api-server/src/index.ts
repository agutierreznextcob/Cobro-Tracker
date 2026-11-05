import { pool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { startRecordatoriosScheduler } from "./lib/recordatorios-scheduler";
import { seedEssentialAccounts } from "./lib/seed";
import { initializeInventarioTriggers } from "./lib/inventario-triggers";
import { startIndicadoresScheduler } from "./lib/indicadores";

// node-postgres emits an 'error' event on idle clients when the backend drops a
// pooled connection (routine in cloud Postgres: idle timeouts, failovers). With
// no listener attached this becomes an uncaught exception that exits the whole
// process — which in a deployment turns into a healthcheck crash loop. Handle it
// so a dead idle connection is logged and discarded instead of killing the API.
pool.on("error", (err) => {
  logger.error({ err }, "Idle Postgres client error (connection discarded)");
});

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

initializeInventarioTriggers().then(() => app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startIndicadoresScheduler();
  // Ensure essential accounts (demo + superadmin) exist. Fire-and-forget with a
  // catch so a seed failure logs but never crashes the process / healthcheck.
  seedEssentialAccounts().catch((err) => {
    logger.error({ err }, "Seed of essential accounts failed");
  });
  startRecordatoriosScheduler();
})).catch((err) => {
  logger.error({ err }, "No se pudo inicializar la protección transaccional de inventario");
  process.exit(1);
});
