# Docker Deployment Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 critical blockers (crash-loop on fresh volume, CORS-blocked login, dropped session cookies) and 5 high-priority warnings so `docker compose up` produces a working production deployment from a fresh host.

**Architecture:** Config-only changes for `.dockerignore`, `Dockerfile`, and `docker-compose.yml`. Code changes in 4 TypeScript files: `lib/db/src/index.ts` (add `runMigrations` export), `artifacts/api-server/src/index.ts` (env validation + migrate call), `artifacts/api-server/src/app.ts` (CORS), `artifacts/api-server/src/lib/session.ts` (cookie secure flag). A one-time local `drizzle-kit generate` produces SQL migration files that are committed; the runner stage already copies `lib/db` wholesale so no Dockerfile copy change is needed.

**Tech Stack:** Node 22-slim, Express 5, better-sqlite3, drizzle-orm ^0.45, drizzle-kit ^0.31, pnpm 10, Docker multi-stage builds.

---

## File Map

| File | Change |
|---|---|
| `.dockerignore` | Add `**/node_modules`, `**/dist`, `**/*.tsbuildinfo` |
| `docker-compose.yml` | Remove `version:`, rename `DATABASE_URL`→`SQLITE_URL`, add `ALLOWED_ORIGINS`, add `COOKIE_SECURE` |
| `Dockerfile` | Pin `pnpm@10`, add `HEALTHCHECK` |
| `lib/db/package.json` | Add `generate` script |
| `lib/db/src/index.ts` | Add `runMigrations()` export |
| `artifacts/api-server/src/index.ts` | Validate `SESSION_SECRET`+`ENCRYPTION_KEY` at boot; call `runMigrations()` in production |
| `artifacts/api-server/src/app.ts` | Expand default CORS origins to include the server's own port |
| `artifacts/api-server/src/lib/session.ts` | Make `Secure` cookie flag driven by `COOKIE_SECURE` env var |
| `.env.example` | Add `SQLITE_URL`, `ALLOWED_ORIGINS`, `COOKIE_SECURE` with docs |

---

## Task 1: Fix .dockerignore

**Files:**
- Modify: `.dockerignore`

Currently `node_modules`, `dist/`, `*.tsbuildinfo` only match at the context root. On a local `docker build`, nested copies (`artifacts/*/node_modules`, `lib/*/dist`) are sent in the build context and can shadow the hoisted install.

- [ ] **Step 1: Replace `.dockerignore` content**

```
node_modules
**/node_modules
.git
.gitignore
*.md
.env
data/
dist/
**/dist
*.tsbuildinfo
**/*.tsbuildinfo
.local/
attached_assets/
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "fix(docker): add nested node_modules/dist patterns to .dockerignore"
```

---

## Task 2: Fix docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

Four changes:
1. Remove `version: "3.9"` (obsolete in Compose v2, generates warnings).
2. Rename `DATABASE_URL` → `SQLITE_URL` — the db package reads `SQLITE_URL` and deliberately ignores `DATABASE_URL`. Currently the volume path lands correctly only by fallback coincidence.
3. Add `ALLOWED_ORIGINS` so the CORS allow-list can include the actual deployment host.
4. Add `COOKIE_SECURE=false` so session cookies work over plain HTTP. Set to `true` when TLS is in front.

- [ ] **Step 1: Overwrite docker-compose.yml**

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "5000:5000"
    volumes:
      - app_data:/app/data
    environment:
      NODE_ENV: production
      PORT: 5000
      SQLITE_URL: file:/app/data/app.db
      SESSION_SECRET: ${SESSION_SECRET}
      ENCRYPTION_KEY: ${ENCRYPTION_KEY}
      ADMIN_EMAIL: ${ADMIN_EMAIL:-admin@example.com}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:-changeme}
      # Comma-separated list of allowed CORS origins.
      # Add your deployment domain here, e.g. https://yourdomain.com
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:-http://localhost:5000}
      # Set to "true" only when a TLS reverse proxy (Caddy, nginx, Traefik) is in front.
      COOKIE_SECURE: ${COOKIE_SECURE:-false}
    restart: unless-stopped

volumes:
  app_data:
    driver: local
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "fix(docker): SQLITE_URL, ALLOWED_ORIGINS, COOKIE_SECURE; drop obsolete version key"
```

---

## Task 3: Fix Dockerfile

**Files:**
- Modify: `Dockerfile`

Two changes:
1. Pin `pnpm@10` instead of `pnpm@latest` — prevents a future pnpm major release from silently breaking the build.
2. Add `HEALTHCHECK` — the API exposes `GET /api/healthz`; Node 22 has `fetch` built-in, so no extra tooling is needed.

- [ ] **Step 1: Overwrite Dockerfile**

```dockerfile
# ─── Stage 1: Install dependencies ───────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY lib/db/package.json ./lib/db/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/accounts-manager/package.json ./artifacts/accounts-manager/
COPY scripts/package.json ./scripts/

RUN echo 'node-linker=hoisted' > .npmrc && pnpm install --frozen-lockfile

# ─── Stage 2: Build ───────────────────────────────────────────────────────────
FROM deps AS builder
WORKDIR /app

COPY . .

RUN pnpm --filter @workspace/api-server run build

# PORT and BASE_PATH are consumed by vite.config.ts at build time
RUN PORT=5000 BASE_PATH=/ pnpm --filter @workspace/accounts-manager run build

# ─── Stage 3: Production runtime ─────────────────────────────────────────────
FROM node:22-slim AS runner
WORKDIR /app

RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid 1001 nodeapp

COPY --from=builder --chown=nodeapp:nodejs /app/artifacts/api-server/dist ./dist
# Frontend build is served as static files from ./public
COPY --from=builder --chown=nodeapp:nodejs /app/artifacts/accounts-manager/dist/public ./public

COPY --from=builder --chown=nodeapp:nodejs /app/lib/db ./lib/db
COPY --from=builder --chown=nodeapp:nodejs /app/node_modules ./node_modules

RUN mkdir -p /app/data && chown nodeapp:nodejs /app/data
VOLUME ["/app/data"]

USER nodeapp

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
```

- [ ] **Step 2: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): pin pnpm@10, add HEALTHCHECK via built-in fetch"
```

---

## Task 4: Startup env validation + migrate call

**Files:**
- Modify: `artifacts/api-server/src/index.ts`

Two additions to `index.ts`:
1. Validate `SESSION_SECRET` and `ENCRYPTION_KEY` at boot — currently both are read lazily so a misconfigured container crashes mid-request instead of at startup.
2. Call `runMigrations()` when `NODE_ENV === "production"` — creates all tables from committed SQL files before `seed()` runs. In development, `drizzle-kit push` is still used manually (unchanged workflow).

> **Note on upgrading existing production volumes:** If you have a production container that was running *before* this PR (no `__drizzle_migrations` table), the tables already exist but `migrate()` will try to re-create them and fail. In that case, delete the volume (`docker compose down -v`) and start fresh — or manually insert a row into `__drizzle_migrations` for each applied migration after the container starts for the first time.

- [ ] **Step 1: Replace `artifacts/api-server/src/index.ts`**

```ts
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
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/index.ts
git commit -m "fix(server): validate SESSION_SECRET+ENCRYPTION_KEY at boot; call runMigrations in production"
```

---

## Task 5: Fix CORS default origins

**Files:**
- Modify: `artifacts/api-server/src/app.ts` (lines 56–80)

The default `allowedOrigins` list (`localhost:5173`, `localhost:8080`) does not include the server's own address. In production, when the frontend is served by the same Express server on port 5000, browser POST requests carry `Origin: http://<host>:5000` which fails the CORS check. Adding the server's port to the defaults fixes this.

- [ ] **Step 1: Replace lines 56–57 in `artifacts/api-server/src/app.ts`**

Find this block (around line 56):
```ts
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") || ["http://localhost:5173", "http://localhost:8080"];
```

Replace with:
```ts
const serverPort = process.env.PORT ?? "5000";
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",") ?? [
  `http://localhost:${serverPort}`,
  `http://127.0.0.1:${serverPort}`,
  "http://localhost:5173",
  "http://localhost:8080",
];
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/app.ts
git commit -m "fix(cors): include server port in default allowed origins for same-origin deployments"
```

---

## Task 6: Make session cookie secure flag configurable

**Files:**
- Modify: `artifacts/api-server/src/lib/session.ts` (line 59)

Currently `secure: process.env.NODE_ENV === "production"`. With `NODE_ENV=production` and plain HTTP (the default compose setup), browsers silently reject `Secure` cookies. The flag should be opt-in via `COOKIE_SECURE=true`, which deployers set only when a TLS reverse proxy is in front.

- [ ] **Step 1: Edit the `setSession` function in `artifacts/api-server/src/lib/session.ts`**

Find (around line 55):
```ts
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS * 1000,
    secure: process.env.NODE_ENV === "production",
  });
```

Replace with:
```ts
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS * 1000,
    secure: process.env.COOKIE_SECURE === "true",
  });
```

Also update `clearSession` on the lines below it — find:
```ts
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
```

Replace with:
```ts
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
  });
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/session.ts
git commit -m "fix(session): drive Secure cookie flag from COOKIE_SECURE env var instead of NODE_ENV"
```

---

## Task 7: Add drizzle migrations (blocker fix)

**Files:**
- Modify: `lib/db/package.json` — add `generate` script
- Modify: `lib/db/src/index.ts` — add `runMigrations()` export
- Create: `lib/db/drizzle/` — generated SQL files (committed)

This is the primary blocker fix. `drizzle-kit generate` statically analyses the TypeScript schema and produces SQL `CREATE TABLE` files. These are committed so the runner stage (which copies `lib/db` wholesale) ships them inside the image. At startup in production, `runMigrations()` applies any unapplied files idempotently using drizzle's internal `__drizzle_migrations` tracking table.

### Step 7a — Add generate script

- [ ] **Step 1: Edit `lib/db/package.json` — add `generate` to scripts**

Find:
```json
  "scripts": {
    "push": "DATABASE_URL=file:./../../data/app.db drizzle-kit push --config ./drizzle.config.ts",
    "push-force": "DATABASE_URL=file:./../../data/app.db drizzle-kit push --force --config ./drizzle.config.ts"
  },
```

Replace with:
```json
  "scripts": {
    "generate": "drizzle-kit generate --config ./drizzle.config.ts",
    "push": "DATABASE_URL=file:./../../data/app.db drizzle-kit push --config ./drizzle.config.ts",
    "push-force": "DATABASE_URL=file:./../../data/app.db drizzle-kit push --force --config ./drizzle.config.ts"
  },
```

### Step 7b — Export runMigrations from lib/db

- [ ] **Step 2: Replace `lib/db/src/index.ts` with the version below**

```ts
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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

/**
 * Apply all pending drizzle migrations from lib/db/drizzle/.
 * Safe to call on startup — skips already-applied migrations.
 * Uses findWorkspaceRoot so the path resolves correctly both in the
 * Docker runner (/app) and in the dev monorepo.
 */
export function runMigrations(): void {
  const root = findWorkspaceRoot(process.cwd());
  const migrationsFolder = path.resolve(root, "lib/db/drizzle");
  migrate(db, { migrationsFolder });
}
```

### Step 7c — Generate migration files

- [ ] **Step 3: Generate SQL migrations**

Run from the workspace root:
```bash
pnpm --filter @workspace/db run generate
```

Expected output (file name will differ):
```
Reading config file 'lib/db/drizzle.config.ts'
...tables found in schema...
[✓] Your SQL migration file ➜ lib/db/drizzle/0000_initial_schema.sql
```

If you see `No config path provided, using default 'drizzle.config.ts'` warnings, they are harmless.

- [ ] **Step 4: Verify migration folder was created**

```bash
ls lib/db/drizzle/
```

Expected: at least one `.sql` file and a `meta/` folder with `_journal.json`.

- [ ] **Step 5: Verify TypeScript still compiles**

```bash
pnpm --filter @workspace/db typecheck 2>$null; pnpm --filter @workspace/api-server run typecheck
```

Expected: no errors from either package.

- [ ] **Step 6: Commit everything**

```bash
git add lib/db/package.json lib/db/src/index.ts lib/db/drizzle/
git commit -m "feat(db): add drizzle migrations; export runMigrations() for production startup"
```

---

## Task 8: Update .env.example

**Files:**
- Modify: `.env.example`

Document the three new env vars so anyone deploying from scratch knows what to set.

- [ ] **Step 1: Replace `.env.example`**

```bash
# ── Database ─────────────────────────────────────────────────────────────────
# SQLite file path. In Docker the volume is mounted at /app/data.
SQLITE_URL=file:/app/data/app.db

# ── Session ──────────────────────────────────────────────────────────────────
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=your-session-secret-here

# ── Encryption ───────────────────────────────────────────────────────────────
# AES-256-GCM key for stored account passwords — must be exactly 64 hex chars (32 bytes).
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=your-64-char-hex-key-here

# ── Admin seed ───────────────────────────────────────────────────────────────
# Credentials for the initial admin account created on first boot.
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me-on-first-login

# ── Server ───────────────────────────────────────────────────────────────────
PORT=5000

# ── CORS ─────────────────────────────────────────────────────────────────────
# Comma-separated list of allowed request origins in production.
# Must include the exact URL users access the app from.
# Default (http://localhost:5000) works for local docker compose up.
# For a real deployment: ALLOWED_ORIGINS=https://yourdomain.com
ALLOWED_ORIGINS=http://localhost:5000

# ── Cookie security ──────────────────────────────────────────────────────────
# Set to "true" only when a TLS reverse proxy (Caddy, nginx, Traefik) is in front.
# Leave as "false" for plain HTTP deployments.
COOKIE_SECURE=false
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: document SQLITE_URL, ALLOWED_ORIGINS, COOKIE_SECURE in .env.example"
```

---

## Task 9: Smoke test

No code changes — verify the full stack works.

- [ ] **Step 1: Create a `.env` file next to `docker-compose.yml` with real values**

```bash
# Run this once to generate secrets:
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('hex'))"
```

Paste both lines into `.env` (already gitignored).

- [ ] **Step 2: Build and start the container**

```bash
docker compose up --build
```

Expected in the logs within ~20 seconds:
```
Database migrations applied
Admin user created   (or "already exists" on restart)
Server listening port=5000
```

No `SqliteError`, no crash-loop, no `ENCRYPTION_KEY`/`SESSION_SECRET` errors.

- [ ] **Step 3: Verify health check**

```bash
curl http://localhost:5000/api/healthz
```

Expected: `{"status":"ok"}`

- [ ] **Step 4: Login smoke test**

Navigate to `http://localhost:5000` in a browser. Log in with `admin@example.com` / `changeme`. Expected: you are redirected to the dashboard, not bounced back to login.

- [ ] **Step 5: Persistence test**

Create a product or account in the UI, then:
```bash
docker compose restart
```

After restart, navigate back and confirm the data still exists (confirms the volume is wired correctly).

- [ ] **Step 6: Final commit (if any fixups were needed)**

```bash
git add -p
git commit -m "fix(docker): smoke test fixups"
```
