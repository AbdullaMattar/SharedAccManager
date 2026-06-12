# Docker Deployment Review — SharedAccManager

**Date:** 2026-06-12
**Scope:** `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.github/workflows/deploy.yml`, and the runtime code paths they exercise.
**Method:** Static analysis. Docker and the `gh` CLI are not installed on this machine and the repo is private to the anonymous GitHub API, so neither a local image build nor the latest CI run status could be verified directly. The commit history (`b1000ca` → `c874d5d` → `5b892a4`) shows the CI image build was iterated to a working state.

---

## Verdict: ❌ NOT ready to deploy

The **image builds correctly**, but a container started from it on a fresh host will **crash-loop on first boot** (no database schema), and even after fixing that, **login is broken** in production mode (CORS) and **sessions are dropped over plain HTTP** (secure cookie). Three blockers must be fixed before this can be deployed.

---

## Critical blockers

### 1. No database schema creation — fresh deploy crash-loops

Nothing in the Docker pipeline creates the SQLite tables:

- The schema only exists locally because `lib/db`'s `push` script (`drizzle-kit push`) was run manually against `data/app.db` on the dev machine.
- `data/` is (correctly) excluded by `.dockerignore`, so the image ships **no database**.
- On first start with an empty `app_data` volume, `artifacts/api-server/src/index.ts:20` runs `await seed()`, which immediately executes `db.select().from(usersTable)` (`seed.ts:18`) → `SqliteError: no such table: users` → top-level await rejects → process exits → `restart: unless-stopped` restarts it forever.

**Fix (recommended):** generate real migrations and apply them at startup.

1. In `lib/db`: `drizzle-kit generate` → produces SQL migrations (e.g. `lib/db/drizzle/`). Commit them.
2. In `api-server/src/index.ts`, before `seed()`:

```ts
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "@workspace/db";
import path from "path";

migrate(db, { migrationsFolder: path.resolve(process.cwd(), "lib/db/drizzle") });
```

3. No Dockerfile change needed — the runner stage already copies `lib/db` wholesale, so the migrations folder lands in the image automatically.

(Alternative: run `drizzle-kit push` in an entrypoint script — it happens to be present in the image because dev `node_modules` are copied — but that is fragile and goes away if issue #6 is fixed.)

### 2. CORS blocks the app's own login in production

`app.ts:56-80`: in production, allowed origins default to `http://localhost:5173` and `http://localhost:8080` (plus `*.replit.dev`). Browsers send an `Origin` header on **all POST/PUT/DELETE requests, including same-origin ones**. A user on `http://<host>:5000` sends `Origin: http://<host>:5000`, which is not in the list → `callback(new Error("Not allowed by CORS"))` → **every login attempt fails with a 500**. This breaks even a local `docker compose up` test at `http://localhost:5000`.

`docker-compose.yml` does not set or pass through `ALLOWED_ORIGINS` at all.

**Fix:** add `ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}` to the compose `environment:` block and document it in `.env.example`, **and/or** make the server accept same-origin requests automatically (e.g. allow when the origin host matches `req.headers.host`). Since the frontend is served by the same Express app, same-origin allowance is the cleanest fix.

### 3. Secure session cookie over plain HTTP

`session.ts:59`: `secure: process.env.NODE_ENV === "production"`, and compose sets `NODE_ENV=production` while serving **plain HTTP on port 5000**. Browsers refuse to store `Secure` cookies over HTTP (localhost is exempted, so a local smoke test would misleadingly pass). On a real host without TLS: login returns 200, the cookie is silently dropped, and every subsequent request is 401.

**Fix:** terminate TLS in front of the container (Caddy / Nginx / Traefik — `trust proxy` is already set to `1` in `app.ts:13`, so `X-Forwarded-*` handling is ready), or make the `secure` flag configurable (e.g. `COOKIE_SECURE=false`) for HTTP-only demo deployments.

---

## Warnings (should fix)

### 4. Missing secrets crash at runtime, not at boot validation

`SESSION_SECRET` and `ENCRYPTION_KEY` are read lazily (`session.ts:9`, `crypto.ts:7`). If `.env` is missing on the deploy host, compose passes empty strings: `ENCRYPTION_KEY` then crashes the container during seeding (seed encrypts a sample account password), and `SESSION_SECRET` would crash the first login request. The failure mode is a confusing crash-loop instead of a clear startup error.
**Fix:** validate both vars (presence + `ENCRYPTION_KEY` is 64 hex chars) at the top of `index.ts` alongside the existing `PORT` check. Remember: a `.env` file with real secrets must exist next to `docker-compose.yml` on the deploy host.

### 5. `DATABASE_URL` in compose is dead configuration

`lib/db/src/index.ts` **deliberately ignores `DATABASE_URL`** and reads `SQLITE_URL`, falling back to `<workspaceRoot>/data/app.db`. In the container there is no `pnpm-workspace.yaml`, so the fallback resolves to `/app/data/app.db` — which **coincidentally** matches the volume mount. It works, but only by accident of the fallback path.
**Fix:** replace `DATABASE_URL: file:/app/data/app.db` with `SQLITE_URL: file:/app/data/app.db` in `docker-compose.yml`.

### 6. Runtime image ships the full dev `node_modules`

`Dockerfile:40` copies the entire hoisted workspace `node_modules` (TypeScript, Vite, React, esbuild, drizzle-kit, all devDependencies) into the runner stage. The bundle only needs **one** external package at runtime: `better-sqlite3`. This inflates the image by hundreds of MB and enlarges the CVE surface.
**Fix:** in the runner stage, install only the runtime external (e.g. a minimal `package.json` with `better-sqlite3` + `pnpm install --prod`), or use `pnpm --filter @workspace/api-server deploy --prod`. Note this removes drizzle-kit from the image — pair with the migration fix in #1.

### 7. `.dockerignore` patterns only match at the context root

`node_modules`, `dist/`, and `*.tsbuildinfo` do not match nested paths, so `artifacts/*/node_modules`, `lib/*/node_modules`, `artifacts/api-server/dist`, and `lib/db/dist` are all sent in the build context. CI is unaffected (clean checkout), but a **local** `docker compose up --build` on this Windows machine would copy pnpm junction/symlink farms into the builder via `COPY . .`, shadowing the hoisted `node_modules` and likely breaking the build — or diverging from what CI produces.
**Fix:** add `**/node_modules`, `**/dist`, `**/*.tsbuildinfo` to `.dockerignore`.

### 8. Unpinned toolchain in the Dockerfile

`corepack prepare pnpm@latest` (`Dockerfile:5`) means a future pnpm major release can silently change install behavior (lockfile compatibility, build-script policy) and break reproducible builds.
**Fix:** pin to a major, e.g. `corepack prepare pnpm@10 --activate`. Optionally pin `node:22-slim` by digest.

### 9. No health check

The API exposes `GET /api/healthz` (`routes/health.ts`), but neither the Dockerfile nor compose defines a health check, so orchestrators consider a crash-looping or wedged container "running". `node:22-slim` has no `curl`/`wget`; use Node:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
```

### 10. Minor items

- `docker-compose.yml:1` — `version: "3.9"` is obsolete in Compose v2 (warning only); remove the line.
- Compose defaults `ADMIN_PASSWORD` to `changeme` and the seed falls back to `admin123` — fine for demo, but override in `.env` for anything reachable from the internet.
- The GitHub workflow has no build cache (`cache-from`/`cache-to: gha`), so every CI build is from scratch — slow but correct.
- CI build status could not be confirmed from this machine (no `gh`, repo private to anonymous API). Verify the latest run of "Build and Push Docker Image" is green before deploying.

---

## What was verified as correct ✅

| Area | Finding |
|---|---|
| Multi-stage structure | deps → builder → runner is sound; build artifacts and runtime cleanly separated |
| Lockfile importer match | The `COPY` list of package.json files exactly matches the lockfile importers (`artifacts/mockup-sandbox` has no package.json, so it is not an importer) — `pnpm install --frozen-lockfile` succeeds |
| Native module (better-sqlite3) | `onlyBuiltDependencies` allowlists its build script under pnpm 10; prebuilt binaries exist for Node 22 / linux-x64 / glibc; `node-linker=hoisted` + copying `node_modules` and `lib/db` makes the esbuild-externalized `require("better-sqlite3")` resolve at runtime (commit `5b892a4`) |
| Base image | `node:22-slim` (glibc) is correct — the workspace overrides strip all musl/darwin/win32 binaries for rollup/lightningcss/tailwind-oxide/esbuild and keep linux-x64-gnu (commit `c874d5d`); the Windows-only root deps install inert on Linux |
| Frontend build | Vite `outDir` is `dist/public`, matching `Dockerfile:37`; `PORT=5000 BASE_PATH=/` build env is consumed by `vite.config.ts` |
| Static serving | Express serves `/app/public` (resolved from cwd `/app`) with SPA fallback and `/api` passthrough; Express 5 wildcard syntax is correct |
| Server binding | Requires `PORT` (compose sets 5000), listens on all interfaces, `EXPOSE 5000` matches the port mapping |
| Security hygiene | Non-root user with correct `chown` on `/app/data` before `USER`; `.env` and `data/` excluded from the image (no secret or DB leakage into layers); ghcr image name is correctly lowercase |
| Logging | Production pino config uses no transport, so the dev-only `pino-pretty` worker is not needed at runtime; the esbuild pino plugin's worker files ship inside `dist/` |
| Persistence | Named volume `app_data` → `/app/data`; WAL mode enabled; DB file lands inside the volume (see warning #5 about *why*) |

---

## Recommended pre-deploy checklist

1. [ ] Add drizzle migrations + `migrate()` at startup (**blocker #1**)
2. [ ] Fix CORS for same-origin / set `ALLOWED_ORIGINS` in compose (**blocker #2**)
3. [ ] Put TLS in front, or make the cookie `secure` flag configurable (**blocker #3**)
4. [ ] Fail fast on missing `SESSION_SECRET` / `ENCRYPTION_KEY`; create `.env` on the deploy host with real values
5. [ ] Rename compose env to `SQLITE_URL`
6. [ ] Add `**/node_modules`, `**/dist`, `**/*.tsbuildinfo` to `.dockerignore`
7. [ ] Pin pnpm version; add `HEALTHCHECK`; remove compose `version:` key
8. [ ] Slim the runner stage to production-only dependencies
9. [ ] Confirm the latest GitHub Actions image build is green, then smoke-test: `docker compose up` on a clean machine → login → create an account → restart container → data persists
