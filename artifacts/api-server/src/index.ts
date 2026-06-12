import app from "./app";
import { logger } from "./lib/logger";
import { startDailyMaintenance } from "./jobs/daily-maintenance";
import seed from "./seed";
import { runMigrations } from "@workspace/db";

// ── Validate required env vars before anything else ──────────────────────────
const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

if (!process.env["SESSION_SECRET"]) throw new Error("SESSION_SECRET environment variable is required.");

const encKey = process.env["ENCRYPTION_KEY"];
if (!encKey) throw new Error("ENCRYPTION_KEY environment variable is required.");
if (Buffer.from(encKey, "hex").length !== 32)
  throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes).");

// ── Apply DB migrations then seed ────────────────────────────────────────────
if (process.env.NODE_ENV === "production") {
  runMigrations();
  logger.info("Database migrations applied");
}

await seed();
startDailyMaintenance();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
