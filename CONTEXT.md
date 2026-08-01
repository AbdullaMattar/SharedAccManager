# Shared Accounts Manager - Agent Context

Last verified from source on 2026-08-01.

This file is for future coding agents. It intentionally separates verified
source facts from stale docs and assumptions. If a claim here matters for a
change, verify the referenced source file first.

## Product Purpose

Shared Accounts Manager is a TypeScript pnpm monorepo for managing resale of
shared subscription accounts.

The current product is more than a staff-only internal app:

- organization users manage products, provider accounts, slots, customers,
  subscriptions, renewals, payments, expiry, and reports;
- organization admins additionally manage settings, users, audit logs, public
  store settings, and data export;
- public users can register a new organization owner account through
  `POST /api/auth/register` using the frontend form on `/login`;
- public buyers can view an organization's store at `/store/:slug`;
- platform superadmins manage organizations and public-store access across
  tenants.

The frontend is Arabic-first and RTL. The root HTML is `lang="ar" dir="rtl"`,
the UI strings live mostly in `artifacts/accounts-manager/src/lib/strings.ts`,
and inputs that hold emails, passwords, phone numbers, or URLs often override
to `dir="ltr"`.

## Core Domain

The unit of sale is a slot, not an account.

```text
Organization
  -> User
  -> Product
      -> Account
          -> Slot
              -> Subscription
                  -> Payment
              -> Customer
  -> Settings
  -> Audit log
```

Domain terms:

- `Organization`: tenant/business. Status is `active` or `suspended`.
- `User`: internal operator. Roles are `admin`, `staff`, and `superadmin`.
  `superadmin` users have `org_id = NULL`.
- `Product`: sellable plan/service type. Holds default capacity, duration,
  price, notes, and tenant id.
- `Account`: real provider account owned by the business. Holds encrypted
  provider password, capacity, status, shared start/expiry dates, and tenant id.
- `Slot`: one sellable seat inside an account. Slots belong to accounts, not
  directly to organizations.
- `Customer`: buyer. Phone is unique per organization.
- `Subscription`: sale history for a slot/customer. Only one stored active
  subscription is allowed per slot.
- `Payment`: money row against one subscription. Refunds are represented by
  negative payment rows.
- `Settings`: tenant-scoped key/value table. Also stores public-store config.
- `Audit log`: tenant-scoped or platform-scoped record of important actions.

Status vocabulary:

```text
Organization: active | suspended
User role:    admin | staff | superadmin
Account:      active | disabled | needs_attention
Slot:         free | occupied | disabled
Subscription: active | expired | cancelled
Payment:      cash | transfer | other
Reminder:     staff | customer | both
```

Money is stored as SQLite `REAL`. Dates are stored as text. Most server date
logic uses UTC JavaScript dates or SQLite `date('now')`; there is no explicit
business-timezone model.

## Repository Layout

```text
artifacts/accounts-manager/   React/Vite frontend
artifacts/api-server/         Express API, jobs, seed, production SPA host
lib/db/                       Drizzle schema, SQLite connection, migrations
lib/api-spec/                 OpenAPI 3.1 spec and Orval config
lib/api-zod/                  Generated Zod/type artifacts from OpenAPI
lib/api-client-react/         Generated React Query client and custom fetcher
scripts/                      Small workspace package plus local launcher script
docs/                         Plans, specs, and deployment runbooks
.agents/memory/               Short repo gotchas for agents
data/                         Local SQLite runtime files, ignored by git
postgresql_/                  Tracked stale/accidental SQLite-looking files
```

Important tracked docs:

- `README.md`: SQLite backup/restore notes.
- `docs/2026-06-15-azure-deployment-incident-runbook.md`: Azure deployment
  invariants and incident history.
- `docs/superpowers/**`: feature plans/specs. Useful history, but verify
  against source before using.
- `problems.md`, `ui_problems.md`, `docker-review.md`: audits. Some findings
  are stale; verify before acting.
- `attached_assets/Pasted--...txt`: original prompt with older target
  architecture. It mentions Next.js/Prisma/Auth.js and is not the current
  architecture.

## Workspace Packages

Root `package.json`:

- enforces pnpm via `preinstall`;
- `pnpm run typecheck` runs lib project references, then typechecks artifacts
  and scripts;
- `pnpm run build` runs typecheck then recursive package builds.

Workspace packages are declared in `pnpm-workspace.yaml`:

- `artifacts/*`
- `lib/*`
- `lib/integrations/*`
- `scripts`

Package roles:

- `@workspace/db`: exports Drizzle `db`, schema tables, generated insert
  schemas, phase 2/3 validation schemas, and `runMigrations()`. The orphaned
  product repair helper is local to `lib/db/src/repair.ts`.
- `@workspace/api-spec`: owns `openapi.yaml`; `pnpm --filter
  @workspace/api-spec run codegen` runs Orval and root lib typecheck.
- `@workspace/api-zod`: exports generated OpenAPI validators/types.
- `@workspace/api-client-react`: exports generated React Query hooks/types and
  `customFetch`.
- `@workspace/api-server`: Express API. Scripts: `dev`, `build`, `start`,
  `typecheck`, `test`.
- `@workspace/accounts-manager`: React/Vite frontend. Scripts: `dev`, `build`,
  `serve`, `typecheck`.
- `@workspace/scripts`: currently mostly empty; `src/index.ts` only exports an
  empty module.

## Runtime Architecture

Development runtime:

```text
Browser
  -> Vite dev server on 5173
  -> /api and /store-images proxy to API_PORT, default 8080
  -> Express API
  -> Drizzle ORM
  -> better-sqlite3
  -> data/app.db unless SQLITE_URL overrides it
```

Production Docker runtime:

```text
Browser
  -> Express static files from /app/public
  -> Express API under /api
  -> Drizzle/better-sqlite3
  -> /app/data/app.db volume
```

API startup in `artifacts/api-server/src/index.ts`:

1. requires `PORT`;
2. requires `SESSION_SECRET`;
3. requires `ENCRYPTION_KEY` and validates it is 32 bytes when decoded from
   hex;
4. in production, requires `PLATFORM_ADMIN_EMAIL` and
   `PLATFORM_ADMIN_PASSWORD`;
5. in production, runs Drizzle migrations via `runMigrations()`;
6. runs `seed()`;
7. starts the daily maintenance cron;
8. listens on `PORT`.

The API process also serves:

- static uploaded public-store images from `/store-images`;
- built SPA files from `public/` when that directory exists;
- `/api` 404 JSON for unknown API routes.

There is no final JSON error middleware in `app.ts`. Thrown async errors are
left to Express' default behavior unless caught by the route.

## Database

Runtime DB connection lives in `lib/db/src/index.ts`.

Facts:

- runtime reads `SQLITE_URL`;
- runtime deliberately ignores `DATABASE_URL`;
- fallback path is `<workspace-root>/data/app.db`;
- parent directory is created automatically;
- SQLite pragmas are `journal_mode`, `busy_timeout = 5000`, and
  `foreign_keys = ON`;
- `SQLITE_JOURNAL_MODE` allowlist is `wal`, `delete`, or `truncate`; default is
  `wal`;
- production Azure deploy sets `SQLITE_JOURNAL_MODE=truncate`;
- local `data/*.db`, `data/*.db-shm`, `data/*.db-wal`, and `data/backups/` are
  ignored by git.

Drizzle tooling is different from runtime:

- `lib/db/drizzle.config.ts` reads `DATABASE_URL`, falling back to
  `file:./data/app.db` resolved from the current working directory;
- `lib/db/package.json` scripts set `DATABASE_URL=file:./../../data/app.db`;
- that inline `VAR=value command` syntax is POSIX style and is not a native
  PowerShell assignment.

Migrations:

- `lib/db/drizzle/0000_wonderful_iron_monger.sql`: initial single-tenant schema.
- `lib/db/drizzle/0001_real_rumiko_fujikawa.sql`: adds `organizations`, tenant
  `org_id` columns, and tenant-scoped settings/customer phone uniqueness.

`runMigrations()` disables foreign keys during migration, re-enables them,
runs `repairOrphanedAccountProducts()`, and then runs `foreign_key_check`.
The repair helper recreates missing products referenced by accounts when each
missing product id belongs to one org only; ambiguous cross-org orphan products
throw.

Tracked data warning:

- `data/app.db` and backups exist locally but are ignored.
- `postgresql_/postgres_password@helium/*` is tracked and appears to be stale
  accidental SQLite database/WAL/SHM data from an earlier `DATABASE_URL` issue.
  Do not add more runtime data to git.

## Schema Details

Source of truth: `lib/db/src/schema/*.ts`.

Tables:

- `organizations`: `id`, `name`, `status`, `created_at`.
- `users`: `id`, `name`, unique `email`, `password_hash`, `role`, nullable
  `org_id`, `disabled`, `created_at`.
- `products`: tenant-scoped product catalog with default capacity, duration,
  price, notes, and created timestamp.
- `accounts`: tenant-scoped provider accounts. References `products`.
  Passwords are stored in `password_encrypted`.
- `slots`: references `accounts` with `onDelete: cascade`. Has `slot_index` and
  `status`.
- `customers`: tenant-scoped customers. Unique index on `(org_id, phone)`;
  indexes on `name` and `phone`.
- `subscriptions`: tenant-scoped slot/customer sale history. Indexes on
  customer, slot, and status. Partial unique index
  `subscriptions_one_active_per_slot_idx` enforces one stored active
  subscription per slot.
- `payments`: tenant-scoped payments. References subscription and optional
  logging user.
- `settings`: composite primary key `(org_id, key)`.
- `audit_log`: optional `user_id`, optional `org_id`, action/entity/entity_id,
  detail, and created timestamp.

There is no unique database constraint on `(account_id, slot_index)`.

## Seeding

Source: `artifacts/api-server/src/seed.ts`.

`seed()` always runs on API startup after env validation and after production
migrations.

Platform admin:

- email defaults to `platform@example.com` outside production;
- password defaults to `platform123` outside production;
- in production, `index.ts` requires `PLATFORM_ADMIN_EMAIL` and
  `PLATFORM_ADMIN_PASSWORD`;
- every startup creates or updates the platform admin user with role
  `superadmin`, `org_id = NULL`, and `disabled = false`;
- if an existing platform-admin email belongs to a non-superadmin or has
  `org_id != NULL`, startup throws.

Demo org:

- demo org id is `1`;
- demo admin is hardcoded as `admin@example.com` / `admin123`;
- demo staff is hardcoded as `staff@example.com` / `staff123`;
- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are present in `.env.example`,
  `docker-compose.yml`, and `deploy.cmd`, but current seed code does not read
  them;
- in production, startup wipes org 1 business data, preserves the two demo
  users, then reseeds demo data;
- outside production, demo data is only inserted when no org-1 product exists.

Current demo data constants seed:

- 6 products;
- 10 accounts;
- 20 customers;
- 30 subscriptions;
- 46 payments by current loop logic.

## API Routes

All routes are composed in `artifacts/api-server/src/routes/index.ts` and
mounted under `/api` by `app.ts`.

Public or auth routes:

- `GET /healthz`: health check.
- `POST /auth/login`: validates generated `LoginBody`, checks bcrypt password,
  blocks disabled users and suspended orgs, sets session, writes login audit
  rows.
- `POST /auth/register`: public signup. Creates organization, owner admin user,
  `business_name` setting, audit row, and session. Uses manual validation in
  the route.
- `POST /auth/logout`: clears the session cookie. It is not protected by
  `requireAuth`.
- `GET /auth/me`: requires auth and returns safe user fields.
- `GET /store/:slug`: public store lookup.

Authenticated org-user routes (`requireAuth`, then `requireOrgUser`):

- products: `GET/POST /products`, `GET/PATCH/DELETE /products/:id`.
- accounts: `GET/POST /accounts`, `GET/PATCH/DELETE /accounts/:id`,
  `POST /accounts/:id/reveal-password`, `GET /accounts/:id/slots`.
- stats: `GET /stats/inventory`.
- customers: `GET/POST /customers`, `GET/PATCH/DELETE /customers/:id`.
- sales: `GET /sales/availability`, `POST /sales`.
- subscriptions: `GET /subscriptions`, `GET /subscriptions/:id`,
  `PATCH /subscriptions/:id/notes`, `POST /subscriptions/:id/cancel`,
  `POST /subscriptions/:id/refund`, `POST /subscriptions/:id/renew`.
- dashboard: `GET /dashboard`.
- expiring: `GET /expiring`.
- reports: `GET /reports/revenue`.

Admin-only org routes (`requireAdmin` after org auth):

- `GET/PATCH /settings`.
- `GET /stats/audit-log`.
- `GET/POST /users`, `PATCH /users/:id`,
  `POST /users/:id/reset-password`.
- `GET/PATCH /website`.
- `PATCH /website/products/:id`.
- `POST /website/products/:id/image`.
- `DELETE /website/products/:id/image`.
- `POST /backup/export`.

Platform-only routes (`requireAuth`, then `requireSuperadmin`):

- `GET /platform/orgs`.
- `POST /platform/orgs/:id/suspend`.
- `POST /platform/orgs/:id/unsuspend`.
- `GET /platform/websites`.
- `PATCH /platform/websites/:id`.
- `POST /platform/orgs/:id/reset-owner-password`.
- `DELETE /platform/orgs/:id`.

RBAC detail:

- `requireAdmin` only allows `role === "admin"`. `superadmin` is not treated as
  an org admin.
- `requireOrgUser` rejects users with `org_id = NULL`.
- `requireSuperadmin` only allows `role === "superadmin"`.
- `requireAuth` reloads the user and joined organization on every request, so
  disabling a user or suspending an organization blocks future authenticated
  requests with the same cookie.

## API Contract and Codegen

Source of truth intended by the repo: `lib/api-spec/openapi.yaml`.

Orval config:

- forces API title to `Api` because generated imports assume that name;
- generates React Query hooks/types into
  `lib/api-client-react/src/generated`;
- generates Zod/type artifacts into `lib/api-zod/src/generated`;
- uses `lib/api-client-react/src/custom-fetch.ts` as mutator for the generated
  React Query client;
- base URL is `/api`;
- output is cleaned and prettified on codegen.

Generated client coverage:

- `openapi.yaml` currently contains most route groups, including dashboard,
  expiring, store, website, platform website access, settings, users, reports,
  platform org list, suspend, and unsuspend.
- The generated React client contains hooks for those documented paths.
- The frontend still uses `artifacts/accounts-manager/src/lib/phase3-api.ts`
  for many phase-three calls. This is current code, not proof the generated
  hooks are unavailable.

Known OpenAPI gaps verified by comparing current routes to `openapi.yaml`:

- `POST /backup/export` is not in `openapi.yaml`.
- `POST /platform/orgs/:id/reset-owner-password` is not in `openapi.yaml`.
- `DELETE /platform/orgs/:id` is not in `openapi.yaml`.

Server validation is mixed:

- products/accounts/auth login use generated `@workspace/api-zod` validators;
- phase 2/3 routes often use schemas exported from `@workspace/db`;
- `auth/register` uses manual route-local validation;
- some query parse failures fall back to empty/default filters instead of
  returning 400, such as account list and audit-log list.

## Frontend

Entry points:

- `artifacts/accounts-manager/index.html`: root HTML, Arabic RTL.
- `artifacts/accounts-manager/src/main.tsx`: creates React root.
- `artifacts/accounts-manager/src/App.tsx`: providers and route map.
- `artifacts/accounts-manager/vite.config.ts`: Vite config, aliases, proxy,
  build output.

Frontend stack:

- React 19;
- Vite 7;
- Wouter routing;
- TanStack Query;
- Tailwind CSS v4;
- shadcn/Radix components;
- lucide-react icons;
- Recharts for dashboard/revenue charts;
- React Hook Form and Zod on several forms.

Routes in `App.tsx`:

- `/login`: login and public registration.
- `/about`: about page.
- `/store/:slug`: public store page.
- `/`: dashboard for org users; platform page for superadmin.
- `/inventory`, `/products`, `/accounts`: inventory/product/account screens.
- `/customers`, `/customers/:id`.
- `/subscriptions`, `/subscriptions/:id`.
- `/sale/new`.
- `/expiring`.
- `/admin/website`.
- `/admin/settings`.
- `/admin/users`.
- `/admin/audit`.
- `/admin/data-security`.
- `/platform`.
- `/platform/websites`.

Guards and layout:

- `AuthProvider` calls generated `useGetMe` and exposes `user`,
  `isLoading`, and `isAuthenticated`.
- `AuthGuard` redirects unauthenticated users to `/login` and wraps protected
  pages in `Layout`.
- `OrgGuard` redirects superadmins away from org pages to `/platform`.
- `AdminGuard` renders an admin-only message for non-admin org users.
- `SuperadminGuard` redirects non-superadmins to `/`.
- `Layout` builds separate nav for superadmins and organization users.

Frontend API layers:

- `@workspace/api-client-react` generated hooks are used directly in earlier
  pages and auth/inventory code.
- `src/lib/phase2-api.ts` re-exports generated hooks and reshapes sale
  availability into available product/slot helpers.
- `src/lib/phase3-api.ts` uses hand-written `fetch` wrappers and TanStack
  Query hooks for dashboard, expiring, renewals, settings, users, audit,
  revenue, platform orgs, public store, website settings, image upload/delete,
  platform website access, org owner password reset, org delete, and backup
  download.

Vite dev server:

- reads `PORT`, default `5173`;
- uses `strictPort: true`;
- proxies `/api` and `/store-images` to `http://localhost:${API_PORT ?? 8080}`;
- aliases `@` to `src` and `@assets` to root `attached_assets`;
- builds to `artifacts/accounts-manager/dist/public`.

## Main Workflows

Sale:

1. `POST /sales` validates `saleInputSchema`.
2. It verifies customer and product belong to the current org.
3. It chooses an explicit slot when `slotId` is provided; otherwise it chooses
   the first free slot in the oldest active, non-expired account for the
   product.
4. It conditionally updates the slot from `free` to `occupied`.
5. It inserts an active subscription whose start/expiry dates come from the
   account.
6. It inserts the payment.
7. It writes a `sale` audit entry.
8. All of the above happens inside one SQLite transaction.
9. The partial unique index on active subscriptions per slot is treated as a
   conflict and returned as HTTP 409.

Subscription list/detail:

- `baseSubscriptionQuery()` joins subscription, customer, slot, account, and
  product.
- The response projection uses account `start_date` and `expiry_date`.
- Computed/effective status logic reads `subscriptions.expiry_date`.
- Detail responses include payments and slot history.

Cancellation:

- `POST /subscriptions/:id/cancel` requires the effective status to be active.
- It updates the subscription to `cancelled`.
- It frees the slot if currently occupied.
- If `refunded` is true, it inserts one negative payment for the current
  positive payment total.
- It writes an audit entry.
- This happens inside one transaction.

Refund after cancellation:

- `POST /subscriptions/:id/refund` only works for `cancelled` subscriptions.
- It inserts a negative payment equal to the remaining positive net total.
- It returns 409 when the subscription is not cancelled or already fully
  refunded.

Renewal:

- `POST /subscriptions/:id/renew` rejects missing subscriptions and cancelled
  subscriptions.
- It allows renewing an expired stored subscription as long as it is not
  cancelled.
- It rejects if another active subscription already exists on the same slot.
- Start date is the later of today's UTC date and the account's current expiry
  date.
- Expiry date is start date plus requested `durationDays`.
- It updates the owning account start/expiry dates.
- It updates all active subscriptions on that account to the new account
  dates.
- It marks the old subscription expired.
- It creates a new active subscription and payment.
- It marks the slot occupied and writes a `renew` audit entry.
- This happens inside one transaction.
- It does not currently check whether the account or slot is disabled before
  renewal.

Account management:

- Account creation validates product ownership and date order.
- Provider password is encrypted before persistence.
- Account creation inserts the account, then inserts `1..capacity` slots.
  This is not wrapped in a transaction.
- Account updates can change label, email, status, dates, notes, password, and
  capacity.
- Capacity cannot be reduced below the number of occupied slots.
- Capacity increases append new free slots.
- Capacity decreases delete free slots from the highest slot indexes.
- Date changes synchronize active subscriptions for all slots on the account.
- Account update capacity/date work is not fully wrapped in one transaction.
- Deleting an account deletes the account row. Slot rows have cascade delete,
  but subscriptions reference slots without cascade, so linked history can
  make deletes fail.

Product management:

- Product routes are tenant-scoped.
- Product delete explicitly rejects products with linked accounts and returns
  HTTP 409.

Customer management:

- Customer phone is unique per organization.
- Customer create defaults `whatsapp` to `phone` if not supplied.
- Customer detail returns total spent based on payment rows plus joined
  subscriptions.
- Customer delete rejects customers with linked subscriptions.

Dashboard/expiry:

- Dashboard includes expiring counts for 1, 3, and 7 days, overdue
  subscriptions, free slots by product, active subscription/account/monthly
  revenue totals, and settings.
- Expiring defaults to `settings.reminderLeadDays` if `days` is not provided.
- `runExpiryRollover()` runs by organization and uses each org's live
  `graceDays` setting.
- It marks active subscriptions expired when `expiry_date < date('now')`.
- It frees occupied slots when an expired subscription is past grace and no
  active subscription exists on the same slot.

Reports:

- Revenue report is based on `payments.amount` and `payments.paid_at`.
- It returns selected month revenue, payment count, average payment, previous
  month revenue, revenue by product, and 12-month trend.

Public store:

- Store settings are stored in `settings` with keys like `store_enabled`,
  `store_slug`, `store_whatsapp`, `store_name`, and `store_description`.
- Product display metadata uses keys like `store_product_<id>_name`,
  `store_product_<id>_description`, and `store_product_<id>_image`.
- Demo org id 1 is always platform-enabled for public store access, even if a
  stale setting says false.
- Non-demo orgs use the saved `store_platform_enabled` setting, default true
  when unset.
- Admins can only enable the org store when platform access is enabled and
  slug/WhatsApp are valid.
- Slugs are lower-case alphanumeric with internal hyphens.
- WhatsApp numbers are normalized by removing spaces, hyphens, and a leading
  plus; valid values are 8-15 digits.
- Product images are saved under `data/store-images` and served from
  `/store-images`.
- Image uploads accept JPEG, PNG, and WebP up to 2 MB.
- Image filenames are `${orgId}-${productId}.${ext}`.
- Public store lookup only returns active organizations whose platform store
  access is enabled, org store is enabled, slug matches, and WhatsApp is valid.
- Public products count free slots from active, non-expired accounts and sort
  available products first.

Backup/export:

- `POST /backup/export` is admin-only and rate limited.
- Body must include `passphrase` with length at least 8.
- `collectOrgData()` only selects data for the current organization.
- Account passwords are decrypted into plaintext for the workbook.
- `buildWorkbookBuffer()` uses `xlsx-populate` password protection.
- Response is an `.xlsx` download.
- Tests verify no cross-tenant leakage in collected backup data and verify
  workbook passphrase behavior.

Platform management:

- Platform org listing aggregates owner email and counts for users, products,
  accounts, customers, subscriptions, and payments.
- Demo org id 1 cannot be suspended, unsuspended, deleted, have website access
  changed, or have owner password reset through platform routes.
- Suspend/unsuspend update organization status and write platform audit rows
  with `org_id = NULL`.
- Suspended orgs are blocked at login and in `requireAuth`.
- Platform website access is stored in tenant settings under
  `store_platform_enabled`.
- Platform delete manually deletes payments, subscriptions, accounts,
  products, customers, settings, audit rows, users, then organization inside
  one transaction.

## Security

Sessions:

- Cookie name is `sam_session`.
- Cookie payload is `{ userId, exp }`, JSON encoded with base64url.
- Signature is HMAC-SHA256 over the encoded payload using `SESSION_SECRET`.
- Max age is seven days.
- Cookie options: `httpOnly`, `sameSite: "lax"`, `secure` only when
  `COOKIE_SECURE === "true"`.
- Password resets do not invalidate already signed cookies. Existing sessions
  continue until expiry unless the user is disabled or their org is suspended.

Passwords:

- Staff passwords use bcryptjs with cost 12 in current seed/user/register code.
- Provider-account passwords use AES-256-GCM.
- `ENCRYPTION_KEY` must be a 64-character hex string representing 32 bytes.
- Encrypted provider password format is a single base64 blob of
  `iv + authTag + ciphertext`, where IV is 12 bytes and auth tag is 16 bytes.
- Revealing a provider password writes a `credential_reveal` audit row.

Rate limits in `app.ts`:

- `/api/auth/login`: 20 requests per 15 minutes.
- `/api/auth/register`: 10 requests per 15 minutes.
- `/api/accounts/:id/reveal-password`: 100 requests per 15 minutes.
- `/api/backup/export`: 100 requests per 15 minutes.

CORS/logging:

- Development CORS allows all origins.
- Production CORS allows missing origin, configured `ALLOWED_ORIGINS`, and
  origins ending in `.replit.dev` or `.repl.co`.
- Pino HTTP logging redacts authorization headers, cookie headers, and
  set-cookie headers.

## Commands

Use pnpm. The root preinstall rejects npm/yarn installs.

Common checks:

```bash
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server test
```

Local app launcher on Windows:

```powershell
.\RUN_APP.cmd
```

`RUN_APP.cmd` runs `scripts/run-app.ps1`, which:

- reads `.env` into process environment;
- requires `pnpm` and existing `node_modules`;
- refuses to start when ports 8080 or 5173 are already in use;
- opens one PowerShell for the API with `NODE_ENV=development`, `PORT=8080`;
- opens one PowerShell for the frontend with `PORT=5173`, `API_PORT=8080`;
- opens `http://localhost:5173`.

Manual dev commands:

```bash
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/accounts-manager run dev
```

Manual API dev requires `PORT`, `SESSION_SECRET`, and `ENCRYPTION_KEY` in the
process environment. The package script itself does not load `.env`; the
Windows launcher does.

Codegen and database tooling:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run generate
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run push-force
```

Remember the DB `push` scripts use POSIX inline `DATABASE_URL=...` syntax.
Adapt if running directly in PowerShell.

## Deployment

Docker:

- Dockerfile uses Node 22 slim.
- Stage `deps` installs pnpm 10 through corepack and runs frozen pnpm install.
- Stage `builder` builds API and frontend.
- Runtime stage copies API `dist`, frontend `dist/public` to `/app/public`,
  `lib/db`, and `node_modules`.
- Runtime command is `node --enable-source-maps ./dist/index.mjs`.
- Healthcheck calls `http://127.0.0.1:5000/api/healthz`.
- `/app/data` is a volume.

Docker Compose:

- builds the Dockerfile;
- maps host `5000` to container `5000`;
- mounts named volume `app_data:/app/data`;
- sets `SQLITE_URL=file:/app/data/app.db`;
- sets `SESSION_SECRET`, `ENCRYPTION_KEY`, `ALLOWED_ORIGINS`, and
  `COOKIE_SECURE`;
- still sets `ADMIN_EMAIL` and `ADMIN_PASSWORD`, but current server seed code
  ignores those variables.

GitHub Actions:

- `.github/workflows/deploy.yml` builds and pushes GHCR images on `main` pushes
  and manual dispatch;
- tags are `latest` and the full commit SHA.

Azure `deploy.cmd`:

- expects `az`, `node`, and `git`;
- waits for the exact current commit SHA image in GHCR before changing Azure;
- uses resource group `shared-acc-rg`, environment `shared-acc-env`, app
  `shared-acc-app`, image repo `ghcr.io/abdullamattar/sharedaccmanager`;
- stores generated secrets in `.deploy-secrets`;
- creates/uses Azure Files share `appdata`;
- mounts Azure Files at `/app/data` with `nobrl`;
- sets `SQLITE_JOURNAL_MODE=truncate`;
- sets min/max replicas to 1;
- deactivates old revisions before update to preserve one SQLite writer;
- rolls back only to a previously active, healthy, provisioned revision;
- considers a revision healthy when active, healthy, provisioned, and replicas
  are at least 1.

Critical deployment invariant:

- Only one active Azure Container Apps revision may access the SQLite database
  on Azure Files. `nobrl` makes SQLite locks client-local, so two active
  revisions can corrupt data.

Do not trust `deploy.cmd`'s printed org-admin credentials if env overrides are
used: it prints `$ADMIN_EMAIL / $ADMIN_PASSWORD`, but current seed code always
uses `admin@example.com / admin123` for the demo org.

## Replit Notes

`.replit` declares Node.js 24 and ports 5173, 8080, 8081, 9998, and 18969.

Artifact configs:

- frontend artifact local port is 5173;
- API artifact local port is 8080 and production run env sets `PORT=8080`;
- frontend production artifact is static;
- API production artifact runs the built API server.

Agent memory notes in `.agents/memory/`:

- Replit may inject a PostgreSQL `DATABASE_URL`; runtime must use
  `SQLITE_URL` instead.
- Replit workflow health checks only support a fixed port list. Use 5173 for
  Vite, not unsupported artifact-assigned ports.

## Known Risks and Sharp Edges

These are current source facts or verified repo-state issues. Do not treat
older docs as proof they are still open or fixed.

- `ADMIN_EMAIL` and `ADMIN_PASSWORD` are dead configuration for current seed
  code. They appear in env examples and deployment scripts but are not read by
  `seed.ts`.
- Production startup wipes and reseeds demo org id 1 on every boot.
- `POST /backup/export`, `POST /platform/orgs/:id/reset-owner-password`, and
  `DELETE /platform/orgs/:id` are implemented routes but missing from
  `openapi.yaml`.
- Frontend phase-three code manually wraps many endpoints even when generated
  hooks exist.
- Account creation and capacity/date reconciliation are not fully
  transactional.
- Product delete is guarded against linked accounts; account delete does not
  have the same explicit linked-history guard.
- There is no final JSON error middleware for uncaught route errors.
- Money uses SQLite `REAL`, not exact decimal storage.
- Business-local day boundaries are not modeled explicitly.
- Password resets do not revoke existing HMAC session cookies.
- `requireAdmin` does not allow `superadmin`; superadmin is platform-only.
- Runtime DB config uses `SQLITE_URL`; Drizzle CLI config uses
  `DATABASE_URL`.
- DB push scripts need adaptation in native PowerShell.
- Local `.env` is not loaded by package scripts; `RUN_APP.cmd` loads it.
- `data/` database files are ignored but present locally.
- `postgresql_/postgres_password@helium/*` is tracked stale runtime data.
- Older docs mention Next.js, Prisma, Auth.js, `DATABASE_URL`, or customizable
  demo admin env vars. Those are not current source truth.

## Verification Pointers

When changing code, start with these files:

- domain schema: `lib/db/src/schema/*.ts`;
- runtime DB: `lib/db/src/index.ts`;
- API composition: `artifacts/api-server/src/app.ts`,
  `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/index.ts`;
- auth/RBAC: `artifacts/api-server/src/lib/session.ts`,
  `artifacts/api-server/src/lib/rbac.ts`;
- sale/renewal/cancel paths: `artifacts/api-server/src/routes/sales.ts`,
  `artifacts/api-server/src/routes/subscriptions.ts`;
- account capacity/date logic: `artifacts/api-server/src/routes/accounts.ts`;
- public store: `artifacts/api-server/src/lib/store-settings.ts`,
  `artifacts/api-server/src/routes/store.ts`,
  `artifacts/api-server/src/routes/website.ts`;
- backup export: `artifacts/api-server/src/lib/backup-export.ts`,
  `artifacts/api-server/src/routes/backup.ts`;
- frontend routes: `artifacts/accounts-manager/src/App.tsx`;
- frontend API wrappers: `artifacts/accounts-manager/src/lib/phase2-api.ts`,
  `artifacts/accounts-manager/src/lib/phase3-api.ts`;
- OpenAPI/codegen: `lib/api-spec/openapi.yaml`,
  `lib/api-spec/orval.config.ts`;
- deployment: `Dockerfile`, `docker-compose.yml`, `deploy.cmd`,
  `docs/2026-06-15-azure-deployment-incident-runbook.md`.

Small automated test coverage currently exists only under
`artifacts/api-server/src/lib/__tests__` and covers settings resolution,
store-settings helpers, backup export behavior, xlsx passphrase behavior, and
orphaned-account product repair. There are no route-level or frontend tests.
