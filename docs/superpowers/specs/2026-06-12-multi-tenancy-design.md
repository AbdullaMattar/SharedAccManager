# Multi-Tenancy: One Site, Many Businesses — Design

**Date:** 2026-06-12
**Status:** Approved by user (conversation, 2026-06-12)

## Goals

Today every business would need its own container deployment. Convert the app to multi-tenant SaaS: one deployment, every business is an `organization` in the shared database.

1. **Public sign-up creates a business**: registrant supplies a business name and becomes the owner (admin) of their own empty workspace; they add staff from the existing users page.
2. **Demo business preserved**: the current deployed data becomes org #1. The demo login button (`admin@example.com` / `admin123`) keeps working forever and showcases all features with the rich dummy data.
3. **Demo auto-reset**: visitors can create/edit/delete freely in the demo org; on every container restart it is wiped and re-seeded (the app scales to zero when idle, so it resets itself regularly).
4. **Platform admin**: a single `superadmin` account (the site operator) sees a table of all businesses with usage counts and can suspend/unsuspend any of them (e.g. for non-payment). Suspension blocks login entirely.

Non-goals: multi-org membership (one user = one business), billing/plans, org deletion UI, email verification, per-org subdomains, read-only suspension mode.

## Data model

New table `organizations`: `id`, `name` (text, not null), `status` (`active` | `suspended`, default `active`), `createdAt`. Org id 1 = the demo business.

`orgId` column (`NOT NULL DEFAULT 1`, FK → organizations.id) added to: `products`, `accounts`, `customers`, `subscriptions`, `payments`, `audit_log`. The `DEFAULT 1` backfills all existing rows into the demo org, so the live Azure Files database upgrades in place. `slots` is not stamped — slots are only ever reached through their account.

`users.orgId` is **nullable** (FK → organizations.id): `NULL` exclusively for the superadmin; all existing users are backfilled to org 1. `users.role` enum gains `superadmin` (now `admin | staff | superadmin`). `users.email` stays globally unique — login is by email alone, unchanged.

Constraint changes (SQLite table rebuilds in the migration):
- `settings`: primary key `key` → composite `(orgId, key)`.
- `customers`: global `phone` unique → composite `UNIQUE(orgId, phone)`.

## Auth & session

Session cookie format unchanged (signed `userId` only) — no forced logouts on deploy. `requireAuth` already loads the full user row per request; it additionally loads the user's organization and rejects with 401 «تم إيقاف حسابكم — يرجى التواصل مع الإدارة» if `status = suspended`. The login route performs the same check. Superadmin (`orgId NULL`) skips the suspension check.

Register (`POST /auth/register`) gains `businessName` (string, min 1) in `RegisterInput`. In one transaction it creates the organization and its owner user (`role: admin`), then auto-logs-in as today. `AuthUser` gains `orgName` (nullable — `NULL` for superadmin) so the UI can display the business name.

## Server scoping

Every business route handler filters by `req.user.orgId`:
- Root tables (`products`, `customers`, `accounts`, `subscriptions`, `payments`, `audit_log`, `settings`): direct `WHERE orgId = user.orgId` on every select/insert/update/delete; inserts stamp `orgId` explicitly.
- Nested resources verify ownership through the parent: slot operations check the slot's account's `orgId`; payment operations check the subscription's `orgId`.
- Users routes (admin-only) are scoped to the admin's own org — an owner only sees and manages their own staff.
- Dashboard, stats, expiring, reports, sales queries all gain the org filter.

Business routes return 403 for the superadmin (it has no org). `/api/platform/*` returns 403 for non-superadmin users.

## Demo org protection & reset

- The two seeded demo users (`admin@example.com`, `staff@example.com`) cannot be edited, deleted, disabled, or password-reset (guard in users routes) — the demo button works forever.
- Everything else in the demo org is fully editable by visitors.
- The demo org (id 1) cannot be suspended (400 from the platform endpoint).
- **Boot sequence** (production, after migrations): ensure platform admin exists → if demo org missing, create it and run the rich seed (scoped to org 1) → if it exists, wipe org-1 business data (products, accounts, slots, customers, subscriptions, payments, org-1 audit entries, and any org-1 users other than the two seeded demo users) and re-seed; reset demo users' passwords to `admin123` / `staff123`. Other orgs are never touched.

## Platform admin

A single user with `role = superadmin`, `orgId NULL`. Credentials from `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` env vars; local dev defaults `platform@example.com` / `platform123`. `deploy.cmd` generates a random password on first run, persists it in `.deploy-secrets`, and prints it in the closing summary — the public demo never exposes a guessable platform login.

Endpoints (OpenAPI → orval codegen, like all others), guarded by new `requireSuperadmin` middleware:
- `GET /platform/orgs` — every organization with: id, name, status, createdAt, owner email (earliest admin), and counts of users, products, accounts, customers, subscriptions, payments.
- `POST /platform/orgs/{id}/suspend` and `POST /platform/orgs/{id}/unsuspend` — flip `status`. Demo org → 400.

Frontend: when the logged-in user is superadmin, the router shows only a platform page (businesses table with stats and a suspend/unsuspend action per row, Arabic strings) — none of the normal business navigation.

## Frontend (business users)

- Registration form: new field «اسم النشاط التجاري» (business name).
- Sidebar header shows the business name (`orgName` from `/auth/me`) instead of the generic app title.
- Suspended-org users see the API's Arabic error on login; no special page needed.
- Everything else unchanged — scoping is server-side.

## Rollout

One drizzle migration (new table, add-columns-with-default, two table rebuilds). Existing Azure Files DB migrates in place on first boot; current live data becomes the demo org. Same CI pipeline and `deploy.cmd` (plus the two new platform-admin env vars). Single replica unchanged.

## Testing

`pnpm run typecheck` across all packages, plus a local production-mode smoke test against a throwaway DB:
1. Fresh boot → migrations, platform admin created, demo org seeded (`products: 6, accounts: 10, customers: 20, subscriptions: 30`).
2. Register a new business → owner lands on an empty dashboard; demo data not visible; demo org unchanged.
3. Restart → demo org wiped and re-seeded; the new business's data untouched.
4. Platform admin login → orgs table shows demo + new business with counts; suspend the new business → its owner's login is rejected with the Arabic message; unsuspend → login works.
