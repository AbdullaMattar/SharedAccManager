import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";

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

// Enable WAL mode for better concurrency
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

export * from "./schema";
