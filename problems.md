# Project Problems Audit

Full audit of SharedAccManager performed 2026-06-10. Issues are grouped by severity.
`pnpm run typecheck` passes — every issue below is a runtime, security, data, or process problem, not a compile error.

---

## CRITICAL

### C1. Production server crashes at startup — invalid Express 5 wildcard route
- **File:** `artifacts/api-server/src/app.ts:48`
- `app.get("*", ...)` is not valid in Express 5 (path-to-regexp v8). Verified locally: it throws `Missing parameter name at index 1: *`.
- The SPA fallback only registers when a `public/` directory exists — which is exactly the Docker production image (Dockerfile copies the frontend build to `./public`). **The Docker container can never boot.** Dev mode hides the bug because `public/` doesn't exist.
- **Fix:** use `app.get("/*splat", ...)` or `app.use((req res) => ...)` as a final middleware.

### C2. Live SQLite database committed to git
- **Files:** `data/app.db`, `data/app.db-shm`, `data/app.db-wal` are all git-tracked (`git status` is permanently dirty on `data/app.db-wal`).
- The DB contains the admin user's bcrypt hash (of the known default `admin123`) and account passwords encrypted with the weak key in `.env` (see C3) — i.e. effectively recoverable. Currently mostly seed data, but any real customer data entered will be silently committed and pushed.
- Also committed: `postgresql_/postgres_password@helium/heliumdb_sslmode=disable{,-shm,-wal}` — junk SQLite files created when a `postgresql://...` URL was mistakenly treated as a file path (see H9), with credentials embedded in the *path name* in git history.
- **Fix:** `git rm --cached data/app.db* postgresql_ -r`, add `data/` and `postgresql_/` to `.gitignore`. Consider history scrubbing if anything real was ever in there.

### C3. Weak/placeholder secrets in `.env`
- **File:** `.env` (not git-tracked — good)
- `SESSION_SECRET=change-this-to-a-long-random-string-in-production` (literal placeholder) and `ENCRYPTION_KEY=000...0001` (31 zero bytes + 1). If the app is ever deployed with these, sessions are forgeable and stored account passwords are decryptable by anyone who reads the docs.
- **Fix:** generate real random values; rotate; re-encrypt stored account passwords.

### C4. CORS reflects any origin **with credentials**
- **File:** `artifacts/api-server/src/app.ts:32-37`
- `cors({ origin: true, credentials: true })` answers `Access-Control-Allow-Origin: <whatever-origin-asked>` + `Allow-Credentials: true`. Any website can make credentialed API calls; only the `SameSite=Lax` cookie attribute is left protecting state-changing requests, and GET endpoints (customer data, audit log, revealed availability info) have no protection from being read cross-origin if SameSite is ever loosened or an older browser is used.
- **Fix:** allowlist the actual frontend origin(s), or drop CORS entirely (same-origin serving makes it unnecessary in production).

### C5. `.env` file is never loaded
- No `dotenv` import anywhere in `artifacts/`, no `--env-file` flag in any start script. The `.env` file at repo root is dead config — the server only sees variables exported in the shell / Replit secrets / compose env.
- Consequence: following the README locally fails — `PORT` is required (`index.ts:8` throws), `SESSION_SECRET`/`ENCRYPTION_KEY` throw on first use, and developers may *believe* they configured strong secrets via `.env` while the process actually runs with whatever the environment happens to contain.
- **Fix:** load env explicitly (e.g. `node --env-file=.env` or `dotenv/config`) or document that `.env` is unused.

---

## HIGH

### H1. Generated API client is stale — OpenAPI-first architecture broken
- `lib/api-spec/openapi.yaml` defines `/dashboard`, `/expiring`, `/settings`, `/users`, `/users/{id}/reset-password`, `/subscriptions/{id}/renew`, `/reports/revenue` — but `lib/api-client-react/src/generated/api.ts` has **no hooks for any of them** (codegen was never re-run after phase 3).
- Instead, `artifacts/accounts-manager/src/lib/phase3-api.ts` hand-rolls `fetch` wrappers typed as `any`, duplicating and re-shaping server responses by hand (e.g. renaming `freeSlots`→`freeCount`, `entity`→`entityType`). This is exactly the drift the "OpenAPI is the single source of truth" decision (replit.md) was meant to prevent.
- Server-side, phase 2/3 routes validate with schemas from `lib/db/src/schema/phase{2,3}-validation.ts` instead of `@workspace/api-zod`, so spec ↔ validation can silently diverge too.
- **Fix:** run `pnpm --filter @workspace/api-spec run codegen`, delete `phase3-api.ts`/`phase2-api.ts` shims, use generated hooks.

### H2. Unhandled FK violations → raw 500s on common deletes
- `DELETE /products/:id` (`products.ts:67`): products are referenced by `accounts.product_id` (no `onDelete`); deleting a product that has accounts throws an unhandled `FOREIGN KEY constraint failed`.
- `DELETE /accounts/:id` (`accounts.ts:191`): slots cascade, but `subscriptions.slot_id` has no `onDelete` — deleting any account whose slots ever had a subscription throws.
- The customers route handles this case properly (`customers.ts:206-254`); accounts and products don't, and there is **no global error handler** (H3), so the client gets an HTML stack page.
- **Fix:** pre-check references (or catch FK errors) and return a 409 with an Arabic message like the customers route does.

### H3. No global Express error handler
- **File:** `artifacts/api-server/src/app.ts`
- Any thrown error (FK violations, `decrypt()` failures on tampered/re-keyed ciphertext, drizzle `.set({})` with empty objects, etc.) falls through to Express's default handler: an HTML error page, including a full stack trace when `NODE_ENV !== "production"`.
- **Fix:** add a final `(err, req, res, next)` middleware that logs and returns `{ error: ... }` JSON.

### H4. Slot reconciliation can create duplicate `slot_index`
- **File:** `artifacts/api-server/src/routes/accounts.ts:165-183`; schema `lib/db/src/schema/slots.ts`
- Shrinking capacity removes *free* slots wherever they are (could be index 3 of 5, leaving 1,2,4,5 occupied... or holes); growing capacity later blindly inserts `slotIndex = existing.capacity + i + 1`, which can collide with surviving indices. There is **no unique index on `(account_id, slot_index)`**, so duplicates are inserted silently and the UI shows two "slot 4"s.
- Also the whole reconcile path (select → delete loop → update) is **not in a transaction**, so a failure mid-way leaves capacity and slot rows inconsistent.
- **Fix:** add `uniqueIndex` on `(accountId, slotIndex)`, compute new indices from actual existing indices, wrap in `db.transaction`.

### H5. Account creation is not atomic
- **File:** `artifacts/api-server/src/routes/accounts.ts:91-102`
- Insert account, then insert slots as a separate statement. A crash between the two leaves an account with zero slots (capacity says 5, sellable slots 0). Same pattern in `seed.ts`.
- **Fix:** wrap in `db.transaction` (sales/renewal routes already do this correctly).

### H6. No rate limiting / lockout on login or password reveal
- **Files:** `routes/auth.ts:10`, `routes/accounts.ts:205`
- `/auth/login` allows unlimited brute force against bcrypt hashes; `/accounts/:id/reveal-password` lets any *staff* account dump every stored credential in a scripted loop (audited, but nothing stops it or alerts on volume). Failed logins are not audit-logged at all.
- **Fix:** add `express-rate-limit` (or similar) on login + reveal, log failed logins.

### H7. Replit deployment target is `autoscale` with a file-based SQLite DB
- **File:** `.replit:6` (`deploymentTarget = "autoscale"`)
- Autoscale instances have ephemeral filesystems and can run multiple replicas: writes are lost on scale-down/redeploy, and two replicas would each have their own `data/app.db`. The in-process daily cron (backups, expiry rollover) also won't run reliably when scaled to zero.
- **Fix:** use a Reserved VM / persistent-disk deployment (or move off file SQLite).

### H8. `scripts/post-merge.sh` calls a non-existent package filter
- **File:** `scripts/post-merge.sh:4` — `pnpm --filter db push`
- The package is named `@workspace/db`. The filter matches nothing, so schema push never happens after merges (and depending on pnpm version the hook errors). Phase-2/3 tables only ever got created because someone ran push manually.
- **Fix:** `pnpm --filter @workspace/db run push`.

### H9. `lib/db` treats *any* `SQLITE_URL` string as a file path
- **File:** `lib/db/src/index.ts:23-28`
- A `postgresql://user:pass@host/db?sslmode=disable` value is happily turned into a directory tree and opened as a new empty SQLite DB — this already happened (the committed `postgresql_/` folder is the fossil), meaning the app silently ran against an **empty database** while looking healthy.
- **Fix:** validate the scheme (`file:` or plain path only) and throw on anything else.

### H10. Dev workflow is broken on Windows (the current dev machine)
- `artifacts/api-server/package.json:7` — `"dev": "export NODE_ENV=development && ..."` — `export` is POSIX-only; fails under cmd/PowerShell.
- `lib/db/package.json:11-12` — `"push": "DATABASE_URL=file:... drizzle-kit push"` — inline `VAR=` prefix is POSIX-only.
- **Fix:** use `cross-env` (or `node --run` w/ env files).

### H11. Vite dev proxy points at the wrong API port
- **File:** `artifacts/accounts-manager/vite.config.ts:57` — proxy target defaults to `http://localhost:3001`, but the API runs on **8080** (README, artifact.toml). Local dev gets 502s on every `/api` call unless `API_PORT` is manually set.
- **Fix:** default to 8080.

---

## MEDIUM

### M1. Three different DB env conventions that contradict each other
- Runtime reads `SQLITE_URL` (`lib/db/src/index.ts:23`); `drizzle.config.ts:4` reads `DATABASE_URL`; `docker-compose.yml:15` sets `DATABASE_URL` (which the runtime **ignores** — the container only works because the workspace-root fallback happens to resolve to `/app/data/app.db`); `.env.example:2` documents `DATABASE_URL`.
- Also `drizzle.config.ts` default (`file:./data/app.db` relative to **cwd**) resolves to `lib/db/data/app.db` — a different file than the runtime DB — if someone runs `drizzle-kit push` without the wrapper script.
- **Fix:** standardize on `SQLITE_URL` everywhere (compose, drizzle config, .env.example).

### M2. Default admin credentials + production seeding
- `seed()` runs unconditionally on every boot (`index.ts:20`): with no `ADMIN_PASSWORD` it creates admin `admin@example.com`/`admin123` (`seed.ts:10`); `docker-compose.yml:19` defaults to `changeme`; README publishes the creds. Seed also inserts 3 sample products and a fake Netflix account into any empty production DB.
- **Fix:** require `ADMIN_PASSWORD` explicitly (fail to boot without it), gate sample-data seeding behind `NODE_ENV !== "production"` or a flag.

### M3. Renewal force-occupies slots regardless of slot/account state
- **File:** `artifacts/api-server/src/routes/subscriptions.ts:245`
- `tx.update(slotsTable).set({ status: "occupied" })` runs unconditionally — renewing an old subscription whose slot was meanwhile **disabled** (or whose account is disabled/needs_attention) silently re-occupies it.
- **Fix:** check slot/account status inside the transaction and 409 if not sellable.

### M4. Money stored as floating-point `REAL`
- `subscriptions.price`, `payments.amount` (`real(...)`) — classic float rounding for currency (Bahraini dinar has 3 decimal places, making binary-float drift more likely in sums like the revenue report).
- **Fix:** store integer fils (milliths) or TEXT decimal.

### M5. All date logic runs on UTC, business is GMT+3
- Expiry comparisons use SQLite `date('now')` (UTC) and `new Date().toISOString()` (`subscription-status.ts:39`, `subscriptions.ts:221`), while `phase3-api.ts:26` computes `daysRemaining` in browser-local time. Subscriptions flip to expired at 3am local, and dashboard counts can disagree with the server by one day around midnight.
- **Fix:** pick the business timezone and use it consistently (e.g. `date('now', '+3 hours')` or store/compare with an explicit TZ).

### M6. Password reset / role change does not invalidate existing sessions
- Sessions are stateless HMAC cookies valid 7 days (`session.ts`). Resetting a compromised user's password (`users.ts:95`) leaves the attacker's cookie fully valid (disabling the user *does* work, since `requireAuth` re-reads the user).
- **Fix:** include a per-user session version/`passwordChangedAt` claim in the payload and check it.

### M7. `/stats/audit-log` bypasses its own validation
- **File:** `artifacts/api-server/src/routes/stats.ts:33-35`
- If query parsing fails it silently falls back to defaults instead of 400; `action` is read from raw `req.query` bypassing the schema; the dedicated `auditQuerySchema` (`phase3-validation.ts:47`) is exported but never used. Same silent-fallback pattern in `GET /accounts` (`accounts.ts:45-46`).
- No pagination beyond `limit` — no `offset`/cursor, so older audit entries are unreachable from the UI.

### M8. N+1 query on accounts list
- **File:** `artifacts/api-server/src/routes/accounts.ts:69-76` — one slots query per account. Fine at 10 accounts, painful at 500. A single grouped join/`IN` query does it.

### M9. LIKE search wildcards not escaped
- **File:** `artifacts/api-server/src/routes/customers.ts:69` — user input goes into `LIKE '%...%'` unescaped, so `%`/`_` in the search box behave as wildcards (not SQL injection — parameterized — just wrong results).

### M10. Dockerfile issues
- **File:** `Dockerfile`
- Copies the **entire workspace `node_modules`** (all dev deps, every package's deps) into the runtime image; the esbuild bundle only needs `better-sqlite3` + pino transport bits. Image is massively larger than needed.
- Copies `lib/db` sources (line 39) — unused at runtime (the bundle inlines them); only confuses.
- `node:22-alpine` while `.replit`/README target Node 24 — version skew.
- No `HEALTHCHECK` despite `/api/healthz` existing.
- Runtime image has no `pnpm-workspace.yaml`, so `findWorkspaceRoot` falls back to `process.cwd()` — works only because `WORKDIR /app` matches the volume path; fragile, and combined with C1 the image never actually ran.

### M11. Duplicate `/api/healthz` with contradicting payloads
- `app.ts:42` returns `{ ok: true }` and shadows `routes/health.ts` which returns `{ status: "ok" }` (the shape declared in the OpenAPI spec). Consumers validating against the spec (`HealthStatus`) see a mismatch.

### M12. No tests
- Zero `*.test.*` / `*.spec.*` files in the repo. Money-handling slot/renewal/grace logic has no automated coverage at all.

---

## LOW

### L1. Login page issues
- **File:** `artifacts/accounts-manager/src/pages/login.tsx`
- `setLocation("/products")` is called **during render** (line 30) — a side effect in render; should be in `useEffect`.
- On success it calls `setLocation(...)` *and* `window.location.href = "/products"` (lines 43-45) — the second makes the first pointless and forces a full reload (also ignores the configured `BASE_URL`).
- Redirects to `/products`, while replit.md says login should land on the dashboard (`/`).
- Inputs lack `autocomplete="email"` / `autocomplete="current-password"`.

### L2. `user: any` in the auth context (`accounts-manager/src/lib/auth.tsx:5`) — discards the typed `useGetMe` response; `AdminGuard` then reads `user?.role` untyped.

### L3. Dead/unused dependencies
- `artifacts/api-server/package.json`: `jsonwebtoken` + `@types/jsonwebtoken` are never imported; `@types/bcryptjs` and `@types/jsonwebtoken` sit in **dependencies** instead of devDependencies (bcryptjs v3 ships its own types — the @types stub is unneeded).

### L4. Template/leftover clutter tracked in git
- `artifacts/mockup-sandbox/` (69 files, scaffolding sandbox), `scripts/src/hello.ts` (hello-world), `replit-prompts/`, `.tmp/`, `attached_assets/`, and `lib/api-spec/node_modules` existing inside a lib dir. None hurt at runtime; all add noise.

### L5. Docs inconsistencies
- `.env.example` documents `DATABASE_URL` + `PORT=5000`; actual setup is `SQLITE_URL` + 8080 (dev) / 5000 (Docker).
- replit.md says drizzle config uses "the hardcoded path in drizzle.config.ts" — actually the path is hardcoded in `lib/db/package.json`'s push script, and the config silently honors any ambient `DATABASE_URL` (the exact var the project promised to ignore).
- README "Run & Operate" commands fail on Windows (see H10) and without env vars (see C5).

### L6. `getSettings()` trusts stored strings (`api-server/src/lib/settings.ts:30-34`) — `Number(...)` can yield `NaN` and the `reminderRecipient` cast is unchecked; a bad row poisons grace-day logic silently (admin PATCH validates, but anything else writing the table doesn't).

### L7. Login CSRF is possible (no CSRF token; `SameSite=Lax` doesn't protect top-level POST form navigations? It does for cookies, but login CSRF needs no cookie). Minor for an internal tool, listed for completeness.

### L8. `Settings`/admin pages are guarded client-side only by `AdminGuard` rendering — fine (server enforces `requireAdmin`), but staff still see admin nav errors as generic toasts; cosmetic.

---

## Quick wins checklist

1. Fix `app.get("*")` → Express-5-safe fallback (C1).
2. `git rm --cached data/app.db* ` + `postgresql_/` and ignore them (C2).
3. Generate real `SESSION_SECRET`/`ENCRYPTION_KEY`; wire up env loading (C3, C5).
4. Pin CORS to the real origin (C4).
5. Re-run Orval codegen and delete the hand-rolled phase3 client (H1).
6. Add a global JSON error handler + FK-aware deletes (H2, H3).
7. Unique index on `(account_id, slot_index)` + transactional slot reconcile (H4, H5).
8. Rate-limit login + reveal-password (H6).
9. Fix `post-merge.sh` filter, Windows-incompatible scripts, and the Vite proxy port (H8, H10, H11).
10. Standardize on `SQLITE_URL` everywhere (M1).
