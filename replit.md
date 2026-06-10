# مدير الحسابات المشتركة (Shared Accounts Manager)

Arabic/RTL staff-only internal web app for managing resold subscription accounts (Netflix, Spotify, ChatGPT, etc.).

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/accounts-manager run dev` — run the frontend (port 5173)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `SESSION_SECRET`, `ENCRYPTION_KEY` — both already set as Replit secrets

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui (RTL, Arabic, Cairo font)
- API: Express 5
- DB: SQLite + Drizzle ORM (better-sqlite3)
- Auth: HMAC-signed cookie sessions (SESSION_SECRET)
- Encryption: AES-256-GCM for stored account passwords (ENCRYPTION_KEY)
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec → React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/db/src/schema/` — all DB table definitions (users, products, accounts, slots, customers, subscriptions, payments, settings, audit_log)
- `lib/db/src/index.ts` — DB connection (SQLite, auto-finds workspace root, ignores DATABASE_URL)
- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/api-zod/` — generated Zod schemas
- `lib/api-client-react/` — generated React Query hooks
- `artifacts/api-server/src/routes/` — auth, products, accounts, stats route handlers
- `artifacts/api-server/src/lib/` — crypto.ts, session.ts, logger.ts
- `artifacts/accounts-manager/src/` — frontend: pages/, components/, lib/
- `artifacts/accounts-manager/src/lib/strings.ts` — all Arabic UI strings
- `data/app.db` — SQLite database file (created automatically)

## Architecture decisions

- **SQLite over PostgreSQL** — self-hosted, zero external deps, file-based for portability.
- **SQLITE_URL env var** — `lib/db` uses `SQLITE_URL` (not `DATABASE_URL`) to avoid conflict with the Replit-managed Postgres `DATABASE_URL` secret.
- **AES-256-GCM encryption** — account passwords encrypted at rest; decrypted only on explicit reveal (audited).
- **HMAC cookie sessions** — stateless, no Redis needed, 7-day expiry.
- **OpenAPI-first** — all contracts in `openapi.yaml`, Orval generates hooks + schemas; server uses generated Zod for validation.
- **Port 5173** — frontend uses port 5173 (Vite default, supported by Replit workflow system). `DATABASE_URL` env var is a Replit-managed PostgreSQL secret — we use `SQLITE_URL` instead.

## Product

- Login page → redirects to dashboard
- Products page: CRUD for subscription service types (Netflix, Spotify, etc.)
- Accounts page: CRUD for shared accounts, visual slot capacity indicators, reveal-password with audit log
- All text in Arabic, full RTL layout, Cairo font, mobile-first

## Default credentials (dev/seed)

- Email: `admin@example.com`
- Password: `admin123`

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **SQLITE_URL vs DATABASE_URL**: `lib/db` deliberately ignores `DATABASE_URL` (it's Postgres). Set `SQLITE_URL=file:./data/app.db` if you need to override the DB path. Default auto-resolves to `<workspaceRoot>/data/app.db`.
- **Workflow port 5173**: accounts-manager frontend uses port 5173. If you see "didn't open port" errors, check the artifact.toml `localPort` matches.
- **After any `lib/db` change**: run `pnpm run typecheck:libs` before rebuilding the API server, or the bundle will use stale declarations.
- **DB push command**: `pnpm --filter @workspace/db run push` uses the hardcoded path in `drizzle.config.ts` (`file:./../../data/app.db`). Tables: users, products, accounts, slots, customers, subscriptions, payments, settings, audit_log.
- **Seed script**: `npx tsx artifacts/api-server/src/seed.ts` (requires `SQLITE_URL` or auto-detect). Creates admin user + 3 sample products + 1 Netflix account with 5 slots.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
