# Shared Accounts Manager - Project Context

## Purpose

Shared Accounts Manager is an internal, staff-only web application for a small
business that resells access to subscription services such as Netflix,
Spotify, and ChatGPT.

The system replaces WhatsApp-based record keeping with a single operational
tool for:

- managing products and the real provider accounts owned by the business;
- selling capacity inside those accounts to customers;
- tracking subscriptions, renewals, payments, expiry, and available capacity;
- protecting provider credentials and auditing sensitive or administrative
  actions.

The application is Arabic-first, RTL-only, mobile-first, and intended for a
small workload. It deliberately runs as one application process backed by one
SQLite file.

## Core Domain Model

The most important domain rule is:

> The unit of sale is a **slot**, not an account.

The inventory and sales chain is:

```text
Product -> Account -> Slot -> Subscription -> Customer
                                  |
                                  -> Payment
```

### Domain Terms

- **Product**: A sellable plan or service type. It defines default capacity,
  duration, and price, but does not represent provider credentials.
- **Account**: A real provider account owned by the business. It belongs to a
  product, contains encrypted credentials, has a configured capacity, and owns
  the shared start and finish dates used by its active subscriptions.
- **Slot**: One sellable unit inside an account. Whole-account products are
  represented as accounts with capacity one.
- **Customer**: The buyer. Phone number is unique and is the practical natural
  identifier.
- **Subscription**: A customer's sale record for one slot. A slot keeps
  subscription history over time; its displayed validity dates come from the
  owning account.
- **Payment**: Money recorded against a subscription. Revenue reports are based
  on payment rows, not subscription prices.
- **User**: An internal staff or admin operator.
- **Audit log entry**: A record of a sensitive or important operator action.
- **Settings**: Key/value operational configuration such as grace days,
  reminder lead days, business name, and currency.

### Status Vocabulary

```text
Account:      active | disabled | needs_attention
Slot:         free | occupied | disabled
Subscription: active | expired | cancelled
User role:    admin | staff
Payment:      cash | transfer | other
```

### Business Invariants

- Every account belongs to one product.
- An account's slots represent its sellable capacity.
- Only a `free` slot in an `active`, non-expired account may be sold.
- A slot may have many historical subscriptions, but the database permits only
  one stored `active` subscription per slot.
- Creating a sale must atomically occupy the slot, create the subscription,
  create its payment, and write an audit entry.
- Cancelling an active subscription frees its slot.
- Renewing creates a **new subscription row** and expires the previous row.
  Renewal history must never be represented by editing the old expiry date.
- Account start and finish dates are the operational source of truth. Sales
  inherit them automatically, and editing/renewing an account synchronizes
  active subscription date snapshots.
- Expired subscriptions may retain an occupied slot during the configured
  grace period. Daily maintenance frees it after grace when no active
  subscription exists.
- Account passwords are stored only as AES-256-GCM ciphertext. Revealing one
  requires authentication and writes an audit entry.
- Admin-only operations include settings, user management, and audit-log
  access.

## Current Architecture

This is a TypeScript pnpm monorepo.

```text
artifacts/accounts-manager/   React/Vite staff web application
artifacts/api-server/         Express API, jobs, auth, and production SPA host
lib/db/                       Drizzle schemas and SQLite connection
lib/api-spec/                 OpenAPI contract and Orval configuration
lib/api-zod/                  Generated request-validation schemas
lib/api-client-react/         Generated React Query client and shared fetcher
data/app.db                   Runtime SQLite database in local development
docs/                         Design specs and implementation plans
```

### Runtime Shape

```text
Browser
  -> React + Wouter + TanStack Query
  -> /api requests
  -> Express routes
  -> Drizzle ORM
  -> better-sqlite3
  -> data/app.db
```

In development, Vite serves the frontend and proxies `/api` to the API server.
In production, the API process also serves the built SPA from `public/`.

The API starts by seeding missing initial data, starts the in-process daily
maintenance job, and then listens on `PORT`.

### Technology

- Node.js, TypeScript, pnpm workspaces
- React 19, Vite, Wouter, TanStack Query
- Tailwind CSS and shadcn/Radix UI components
- Express 5
- SQLite, better-sqlite3, Drizzle ORM
- Zod and drizzle-zod
- OpenAPI 3.1 and Orval code generation
- bcrypt for staff password hashes
- HMAC-signed cookie sessions
- AES-256-GCM for provider-account passwords
- Pino logging and node-cron maintenance

## Package Boundaries and Sources of Truth

### Database and Domain Persistence

`lib/db/src/schema/` is the source of truth for persisted tables, constraints,
and indexes. `lib/db/src/index.ts` owns the SQLite connection, enables WAL and
foreign keys, and exports the Drizzle database.

Runtime database configuration uses `SQLITE_URL`, falling back to
`<workspace-root>/data/app.db`. `DATABASE_URL` is intentionally ignored by the
runtime connection.

### API Contract

`lib/api-spec/openapi.yaml` is intended to be the source of truth for HTTP
contracts. Orval generates:

- React Query hooks and TypeScript API types in `lib/api-client-react`;
- Zod request schemas in `lib/api-zod`.

After changing the OpenAPI document, run code generation and commit the
generated changes.

The intended contract boundary is currently incomplete: phase-three frontend
operations in `artifacts/accounts-manager/src/lib/phase3-api.ts` are hand-written
and the generated client does not currently include dashboard, expiring,
settings, users, renewals, or revenue-report operations. Some server routes
also validate with schemas exported by `lib/db` rather than generated API Zod
schemas. Treat this as known contract drift, not a preferred pattern.

### Frontend

`artifacts/accounts-manager/src/App.tsx` defines routes and access guards.
Authenticated pages render inside `Layout`. Admin pages have both a client-side
`AdminGuard` and server-side admin authorization.

All UI is expected to be Arabic and RTL. Prefer centralized copy in
`artifacts/accounts-manager/src/lib/strings.ts`, logical CSS properties, and
mobile layouts that work at 375px.

### API

`artifacts/api-server/src/routes/index.ts` composes all route modules.
Authenticated routes use `requireAuth`; admin routes additionally use
`requireAdmin`.

Important shared API helpers:

- `lib/session.ts`: signs and verifies the seven-day `sam_session` cookie and
  reloads the user on every authenticated request.
- `lib/crypto.ts`: encrypts and decrypts provider-account passwords.
- `lib/subscription-query.ts`: shared joined subscription projection.
- `lib/subscription-status.ts`: computes effective status for date-sensitive
  reads.
- `lib/settings.ts`: loads typed operational settings with defaults.

## Primary Workflows

### Inventory Setup

1. Staff creates a product with default capacity, duration, and price.
2. Staff creates a real provider account for that product and records its
   shared start and finish dates.
3. The password is encrypted before persistence.
4. Slot rows numbered `1..capacity` are created for the account.
5. Capacity edits reconcile slot rows; occupied slots must not be removed.

### Sale

1. Staff selects a product and customer.
2. Staff may select a specific free slot or let the API choose the first free
   slot in the oldest active, non-expired account.
3. The sale inherits its validity dates from the chosen account.
4. Inside one SQLite transaction, the API conditionally marks the slot
   occupied, inserts an active subscription, inserts a payment, and writes a
   `sale` audit entry.
5. The partial unique subscription index protects against two active
   subscriptions using the same slot.

### Renewal

1. Staff renews an existing non-cancelled subscription.
2. The new start date is the later of today or the previous expiry date.
3. Inside one transaction, the old subscription becomes expired, a new active
   subscription and payment are created, the slot is occupied, and a `renew`
   audit entry is written.

### Cancellation

Inside one transaction, an active subscription becomes cancelled, its occupied
slot becomes free, and an audit entry is written.

### Expiry and Maintenance

Reads can compute an effective expired status before the stored status has been
updated. At `00:05` server time, daily maintenance:

1. persists expired status for past-due active subscriptions;
2. frees occupied slots after the live `grace_days` setting when no active
   subscription remains;
3. creates a consistent SQLite backup in `data/backups/`;
4. retains the newest 14 daily backups.

## Security Model

- Staff passwords are bcrypt hashes.
- Sessions are stateless HMAC-signed, HTTP-only cookies with a seven-day
  expiry. `requireAuth` reloads the user, so disabling a user blocks their
  existing session.
- Provider-account passwords use AES-256-GCM with `ENCRYPTION_KEY`.
- Credential reveal and important business/admin actions are audited.
- Login and credential-reveal endpoints are rate limited.
- Production CORS uses `ALLOWED_ORIGINS` plus Replit domains.
- Sensitive values must come from environment variables and must never be
  committed.

Required runtime environment:

```text
PORT
SESSION_SECRET
ENCRYPTION_KEY
```

Common optional environment:

```text
SQLITE_URL
ADMIN_EMAIL
ADMIN_PASSWORD
ALLOWED_ORIGINS
NODE_ENV
```

## Operating Commands

Use pnpm. The workspace rejects npm installs.

```bash
pnpm run typecheck
pnpm run build
pnpm --filter @workspace/api-server run dev
pnpm --filter @workspace/accounts-manager run dev
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/db run push
```

The API requires `PORT`, `SESSION_SECRET`, and `ENCRYPTION_KEY` in the process
environment. The repository `.env` file is not automatically loaded by the
current start scripts.

The API `dev` and DB `push` package scripts use POSIX environment syntax and do
not run directly in Windows PowerShell without adaptation.

## Deployment and Data

The Docker image builds both applications, runs the Express API as the single
process, serves the SPA, and mounts `/app/data` as a named volume.

SQLite is part of the application's operational architecture:

- deploy only where one process/replica has durable access to the same file;
- do not use an ephemeral or autoscaled multi-replica target;
- stop the API before manually restoring a backup;
- preserve the database, WAL, and SHM files when investigating data issues.

## Known Risks and Constraints

These are current-system facts that should influence changes:

- There are no automated tests. Sales, renewal, slot reconciliation, expiry,
  money, and auth changes require especially careful verification.
- Money is stored as SQLite `REAL`; do not assume exact decimal arithmetic.
- Date comparisons mostly use UTC/SQLite `date('now')`; business-local day
  boundaries are not explicitly modeled.
- Account creation and capacity reconciliation are not fully transactional.
- Slots do not have a unique `(account_id, slot_index)` constraint.
- Product/account deletes may surface raw foreign-key errors, and the API has
  no final JSON error middleware.
- Renewals currently re-occupy a slot without checking whether the slot or
  account has since been disabled.
- Password resets do not invalidate existing signed sessions.
- Startup seeding runs in every environment and has default admin credentials
  and sample data when variables/data are absent.
- Runtime, Drizzle tooling, Docker, and documentation do not consistently use
  the same SQLite environment-variable convention.
- Live SQLite and accidental database files are currently present in the
  repository. Do not add or commit new runtime data.
- `problems.md` and `ui_problems.md` are audits, but some listed items have
  already been fixed. Verify against current code before acting on them.
- The original attached phase-one prompt and parts of `replit.md` describe an
  earlier target architecture and scope. The current application includes all
  three product phases and uses React/Vite, Express, and Drizzle rather than
  Next.js, Prisma, and Auth.js.

## Change Guidance

- Preserve the slot-centered domain model.
- Use transactions for any workflow that changes multiple related rows.
- Preserve historical subscription and payment records.
- Keep server authorization as the real security boundary; client guards are
  only presentation.
- Update OpenAPI first for contract changes, regenerate clients/schemas, then
  align server validation and frontend usage.
- Keep Arabic/RTL/mobile behavior intact for every user-facing change.
- Keep credentials and secrets out of logs, API lists, and persisted plaintext.
- Validate changes with at least `pnpm run typecheck`; use `pnpm run build` for
  changes that affect runtime packaging or frontend production behavior.
