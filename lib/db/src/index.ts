import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import path from "path";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";
import { repairOrphanedAccountProducts } from "./repair";

// Walk up from CWD to find the monorepo root (contains pnpm-workspace.yaml)
function findWorkspaceRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

const workspaceRoot = findWorkspaceRoot(process.cwd());

// Use SQLITE_URL if set; otherwise fall back to a fixed path.
// DATABASE_URL is intentionally ignored here — it may point to a Postgres DB.
const rawDbUrl = process.env.SQLITE_URL ?? `file:${path.resolve(workspaceRoot, "data/app.db")}`;
const dbPath = rawDbUrl.replace(/^file:/, "");

const resolvedDbPath = path.isAbsolute(dbPath)
  ? dbPath
  : path.resolve(workspaceRoot, dbPath);

// Ensure parent directory exists
mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

const sqlite = new Database(resolvedDbPath);

// Journal mode: WAL by default for local concurrency. On network filesystems
// (e.g. Azure Files SMB mounts) WAL cannot work — set SQLITE_JOURNAL_MODE=delete.
const requestedJournalMode = (process.env.SQLITE_JOURNAL_MODE ?? "wal").toLowerCase();
const journalMode = ["wal", "delete", "truncate"].includes(requestedJournalMode)
  ? requestedJournalMode
  : "wal";
sqlite.pragma(`journal_mode = ${journalMode}`);
sqlite.pragma("busy_timeout = 5000");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export * from "./schema";

/**
 * Apply all pending drizzle migrations from lib/db/drizzle/.
 * Safe to call on every startup — already-applied migrations are skipped.
 * findWorkspaceRoot resolves correctly in Docker (/app, no workspace yaml)
 * and in the dev monorepo (walks up to the pnpm-workspace.yaml root).
 */
export function runMigrations(): void {
  const root = findWorkspaceRoot(process.cwd());
  const migrationsFolder = path.resolve(root, "lib/db/drizzle");
  sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }
  const repairedProducts = repairOrphanedAccountProducts(sqlite);
  if (repairedProducts > 0) {
    console.warn(`Recreated ${repairedProducts} missing products referenced by existing accounts.`);
  }
  const foreignKeyIssues = sqlite.pragma("foreign_key_check") as unknown[];
  if (foreignKeyIssues.length > 0) {
    throw new Error(`Foreign key check failed after migrations: ${JSON.stringify(foreignKeyIssues)}`);
  }
}
