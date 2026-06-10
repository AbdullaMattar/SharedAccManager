---
name: SQLite vs DATABASE_URL conflict
description: Replit injects a Postgres DATABASE_URL secret that conflicts with SQLite path in lib/db — use SQLITE_URL instead.
---

**Rule:** `lib/db/src/index.ts` must use `process.env.SQLITE_URL` (not `DATABASE_URL`) to build the SQLite connection path.

**Why:** Replit automatically injects a `DATABASE_URL` secret pointing to a managed PostgreSQL database (e.g. `postgresql://postgres:password@helium/heliumdb?sslmode=disable`). When `lib/db` naively reads `DATABASE_URL`, it tries to open a path like `/home/runner/workspace/postgresql:/postgres:...` as a SQLite file, which opens an empty new DB with no tables.

**How to apply:** In `lib/db/src/index.ts`, the env var priority is:
1. `process.env.SQLITE_URL` (explicit override)
2. Auto-detected path: `<workspaceRoot>/data/app.db`

Never fall back to `DATABASE_URL`. The drizzle.config.ts push script hardcodes `file:./../../data/app.db` and is unaffected.
