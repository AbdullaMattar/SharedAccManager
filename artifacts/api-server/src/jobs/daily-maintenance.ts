import cron from "node-cron";
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { db, slotsTable, subscriptionsTable } from "@workspace/db";
import { and, eq, lt, sql } from "drizzle-orm";
import { getSettings } from "../lib/settings";
import { logger } from "../lib/logger";

function workspaceRoot(): string {
  let current = process.cwd();
  while (path.dirname(current) !== current) {
    if (existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    current = path.dirname(current);
  }
  return process.cwd();
}

function databasePath(): string {
  const root = workspaceRoot();
  const raw = process.env.SQLITE_URL ?? `file:${path.join(root, "data/app.db")}`;
  const value = raw.replace(/^file:/, "");
  return path.isAbsolute(value) ? value : path.resolve(root, value);
}

export async function runExpiryRollover(): Promise<void> {
  const { graceDays } = await getSettings();
  const result = db.transaction((tx) => {
    const expired = tx.update(subscriptionsTable)
      .set({ status: "expired" })
      .where(and(
        eq(subscriptionsTable.status, "active"),
        lt(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now')`),
      )).run();
    const freed = tx.run(sql`
      update ${slotsTable}
      set status = 'free'
      where status = 'occupied'
        and exists (
          select 1 from subscriptions expired_subscription
          where expired_subscription.slot_id = ${slotsTable.id}
            and expired_subscription.status = 'expired'
            and date(expired_subscription.expiry_date, ${`+${graceDays} days`}) < date('now')
        )
        and not exists (
          select 1 from subscriptions active_subscription
          where active_subscription.slot_id = ${slotsTable.id}
            and active_subscription.status = 'active'
        )
    `);
    return { expired: expired.changes, freed: freed.changes };
  });
  logger.info(result, "Daily subscription expiry rollover complete");
}

export async function runBackup(): Promise<void> {
  const source = databasePath();
  const backupDir = path.join(path.dirname(source), "backups");
  mkdirSync(backupDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const temporary = path.join(backupDir, `app-${date}.tmp.db`);
  const destination = path.join(backupDir, `app-${date}.db`);
  const sqlite = new Database(source, { readonly: true });
  try {
    await sqlite.backup(temporary);
    copyFileSync(temporary, destination);
    rmSync(temporary, { force: true });
  } finally {
    sqlite.close();
  }
  const backups = readdirSync(backupDir)
    .filter((name) => /^app-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .sort()
    .reverse();
  for (const old of backups.slice(14)) rmSync(path.join(backupDir, old));
  logger.info({ destination }, "Daily SQLite backup complete");
}

export function startDailyMaintenance(): void {
  cron.schedule("5 0 * * *", async () => {
    try {
      await runExpiryRollover();
      await runBackup();
    } catch (error) {
      logger.error({ error }, "Daily maintenance failed");
    }
  }, { name: "daily-maintenance", noOverlap: true });
}
