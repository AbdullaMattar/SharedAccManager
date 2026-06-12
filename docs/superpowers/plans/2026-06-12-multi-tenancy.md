# Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert SharedAccManager from a single-business app to multi-tenant SaaS — one deployment, every business is an `organization`; demo org auto-resets on container restart; platform admin can suspend any business.

**Architecture:** Add an `organizations` table and stamp every business-owned row with an `orgId`. `products`, `accounts`, `customers`, `subscriptions`, `payments`, and `settings` use `orgId NOT NULL DEFAULT 1`; `users.orgId` and `audit_log.orgId` remain nullable so the superadmin can exist and platform-level audit entries can be represented. Session middleware loads the org on every request and rejects suspended orgs. A superadmin user (`orgId NULL`) manages all orgs via `/api/platform/*` endpoints. The frontend shows a platform page (orgs table) exclusively to the superadmin and adds a `businessName` field to public registration.

**Tech Stack:** SQLite + Drizzle ORM — schema changes + hand-edited migration; Express.js — new middleware + platform routes; Orval codegen — OpenAPI → Zod + React Query; React + Wouter — new registration field, superadmin platform page.

---

## File Structure

**New files:**
- `lib/db/src/schema/organizations.ts` — organizations table
- `artifacts/api-server/src/routes/platform.ts` — superadmin org management endpoints
- `artifacts/accounts-manager/src/pages/platform.tsx` — superadmin organizations view

**Modified files (backend):**
- `lib/db/src/schema/users.ts` — add `orgId` (nullable FK), expand `role` to include `superadmin`
- `lib/db/src/schema/products.ts` — add `orgId NOT NULL DEFAULT 1`
- `lib/db/src/schema/accounts.ts` — add `orgId NOT NULL DEFAULT 1`
- `lib/db/src/schema/customers.ts` — add `orgId NOT NULL DEFAULT 1`, composite unique `(orgId, phone)`
- `lib/db/src/schema/subscriptions.ts` — add `orgId NOT NULL DEFAULT 1`
- `lib/db/src/schema/payments.ts` — add `orgId NOT NULL DEFAULT 1`
- `lib/db/src/schema/audit-log.ts` — add `orgId` nullable
- `lib/db/src/schema/settings.ts` — composite PK `(orgId, key)`
- `lib/db/src/schema/index.ts` — export organizations
- `lib/db/src/index.ts` — disable FK enforcement around Drizzle's migration transaction, then run `foreign_key_check`
- `lib/db/drizzle/0001_multi_tenancy.sql` — generated then hand-edited migration
- `artifacts/api-server/src/lib/session.ts` — `requireAuth` loads org, checks suspension
- `artifacts/api-server/src/lib/rbac.ts` — add `requireSuperadmin` + `requireOrgUser`
- `artifacts/api-server/src/routes/auth.ts` — register gains `businessName`, login/me gain org checks
- `artifacts/api-server/src/routes/products.ts` — orgId filter + stamp (canonical example)
- `artifacts/api-server/src/routes/accounts.ts` — orgId filter + stamp
- `artifacts/api-server/src/routes/customers.ts` — orgId filter + stamp
- `artifacts/api-server/src/routes/subscriptions.ts` — orgId filter + stamp
- `artifacts/api-server/src/routes/sales.ts` — scope availability and sale ownership checks; stamp inserts
- `artifacts/api-server/src/routes/dashboard.ts` — orgId filter
- `artifacts/api-server/src/routes/stats.ts` — orgId filter
- `artifacts/api-server/src/routes/expiring.ts` — orgId filter
- `artifacts/api-server/src/routes/reports.ts` — orgId filter
- `artifacts/api-server/src/routes/settings.ts` — orgId filter + composite key
- `artifacts/api-server/src/routes/users.ts` — orgId filter + demo user guard
- `artifacts/api-server/src/lib/settings.ts` — `getSettings(orgId)` helper
- `artifacts/api-server/src/lib/subscription-query.ts` — org-aware base query with one composed `WHERE`
- `artifacts/api-server/src/jobs/daily-maintenance.ts` — per-org settings and expiry rollover
- `artifacts/api-server/src/routes/index.ts` — register platform router
- `artifacts/api-server/src/seed.ts` — restructured boot sequence
- `artifacts/api-server/src/index.ts` — validate new env vars, call boot sequence

**Modified files (frontend + spec):**
- `lib/api-spec/openapi.yaml` — `businessName` in `RegisterInput`, `orgName` in `AuthUser`, platform tag + schemas + paths
- `artifacts/accounts-manager/src/pages/login.tsx` — `businessName` input in register mode
- `artifacts/accounts-manager/src/components/layout.tsx` — use `user?.orgName` for sidebar header
- `artifacts/accounts-manager/src/App.tsx` — superadmin-only routing
- `artifacts/accounts-manager/src/lib/strings.ts` — new string keys
- `.env.example` — `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD`
- `deploy.cmd` — generate random platform password, persist + print

---

## Task 1: DB Schema — organizations table + orgId columns on all tables

**Files:**
- Create: `lib/db/src/schema/organizations.ts`
- Modify: `lib/db/src/schema/users.ts`
- Modify: `lib/db/src/schema/products.ts`
- Modify: `lib/db/src/schema/accounts.ts`
- Modify: `lib/db/src/schema/customers.ts`
- Modify: `lib/db/src/schema/subscriptions.ts`
- Modify: `lib/db/src/schema/payments.ts`
- Modify: `lib/db/src/schema/audit-log.ts`
- Modify: `lib/db/src/schema/settings.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `lib/db/src/index.ts`
- Generate: `lib/db/drizzle/0001_multi_tenancy.sql`

- [ ] **Step 1: Create `lib/db/src/schema/organizations.ts`**

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const organizationsTable = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "suspended"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export type Organization = typeof organizationsTable.$inferSelect;
```

- [ ] **Step 2: Update `lib/db/src/schema/users.ts`** — add nullable `orgId` FK, expand `role` enum

Replace the entire file:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

export const usersTable = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "staff", "superadmin"] }).notNull().default("staff"),
  orgId: integer("org_id").references(() => organizationsTable.id),
  disabled: integer("disabled", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
```

- [ ] **Step 3: Update `lib/db/src/schema/products.ts`** — add `orgId NOT NULL DEFAULT 1`

Replace the entire file:

```ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

export const productsTable = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
  name: text("name").notNull(),
  service: text("service").notNull(),
  defaultCapacity: integer("default_capacity").notNull().default(1),
  defaultDurationDays: integer("default_duration_days").notNull().default(30),
  defaultPrice: real("default_price").notNull().default(0),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const insertProductSchema = createInsertSchema(productsTable).omit({ id: true, createdAt: true, orgId: true });
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof productsTable.$inferSelect;
```

- [ ] **Step 4: Update `lib/db/src/schema/accounts.ts`** — add `orgId NOT NULL DEFAULT 1`

Replace the entire file:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { productsTable } from "./products";
import { organizationsTable } from "./organizations";

export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  label: text("label").notNull(),
  email: text("email").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  capacity: integer("capacity").notNull().default(1),
  status: text("status", { enum: ["active", "disabled", "needs_attention"] }).notNull().default("active"),
  startDate: text("start_date").notNull().default(sql`(date('now'))`),
  expiryDate: text("expiry_date").notNull().default(sql`(date('now', '+30 days'))`),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true, orgId: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
```

- [ ] **Step 5: Update `lib/db/src/schema/customers.ts`** — add `orgId`, change unique from `phone` to `(orgId, phone)`

Replace the entire file:

```ts
import { sqliteTable, text, integer, index, unique } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

export const customersTable = sqliteTable(
  "customers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    whatsapp: text("whatsapp"),
    email: text("email"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    unique("customers_org_phone_unique").on(table.orgId, table.phone),
    index("customers_name_idx").on(table.name),
    index("customers_phone_idx").on(table.phone),
  ],
);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  createdAt: true,
  orgId: true,
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
```

- [ ] **Step 6: Update `lib/db/src/schema/subscriptions.ts`** — add `orgId NOT NULL DEFAULT 1`

Replace the entire file:

```ts
import {
  sqliteTable, text, integer, real, index, uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { slotsTable } from "./slots";
import { customersTable } from "./customers";
import { organizationsTable } from "./organizations";

export const subscriptionsTable = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
    slotId: integer("slot_id").notNull().references(() => slotsTable.id),
    customerId: integer("customer_id").notNull().references(() => customersTable.id),
    startDate: text("start_date").notNull(),
    expiryDate: text("expiry_date").notNull(),
    price: real("price").notNull().default(0),
    status: text("status", { enum: ["active", "expired", "cancelled"] }).notNull().default("active"),
    notes: text("notes"),
    createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
  },
  (table) => [
    index("subscriptions_customer_idx").on(table.customerId),
    index("subscriptions_slot_idx").on(table.slotId),
    index("subscriptions_status_idx").on(table.status),
    uniqueIndex("subscriptions_one_active_per_slot_idx")
      .on(table.slotId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  id: true,
  createdAt: true,
  orgId: true,
});
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
```

- [ ] **Step 7: Update `lib/db/src/schema/payments.ts`** — add `orgId NOT NULL DEFAULT 1`

Replace the entire file:

```ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { subscriptionsTable } from "./subscriptions";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const paymentsTable = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id),
  amount: real("amount").notNull(),
  method: text("method", { enum: ["cash", "transfer", "other"] }).notNull().default("cash"),
  paidAt: text("paid_at").notNull().default(sql`(datetime('now'))`),
  loggedBy: integer("logged_by").references(() => usersTable.id),
  notes: text("notes"),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true, orgId: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
```

- [ ] **Step 8: Update `lib/db/src/schema/audit-log.ts`** — add nullable `orgId`

Replace the entire file:

```ts
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const auditLogTable = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").references(() => organizationsTable.id),
  userId: integer("user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: integer("entity_id"),
  detail: text("detail"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const insertAuditLogSchema = createInsertSchema(auditLogTable).omit({ id: true, createdAt: true });
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogTable.$inferSelect;
```

- [ ] **Step 9: Update `lib/db/src/schema/settings.ts`** — composite PK `(orgId, key)`

Replace the entire file:

```ts
import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { organizationsTable } from "./organizations";

export const settingsTable = sqliteTable(
  "settings",
  {
    orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
    key: text("key").notNull(),
    value: text("value").notNull(),
  },
  (table) => [primaryKey({ columns: [table.orgId, table.key] })],
);

export type Setting = typeof settingsTable.$inferSelect;
```

- [ ] **Step 10: Update `lib/db/src/schema/index.ts`** — export organizations first

Replace the entire file:

```ts
export * from "./organizations";
export * from "./users";
export * from "./products";
export * from "./accounts";
export * from "./slots";
export * from "./customers";
export * from "./subscriptions";
export * from "./payments";
export * from "./settings";
export * from "./audit-log";
export * from "./phase2-validation";
export * from "./phase3-validation";
```

- [ ] **Step 11: Generate the migration**

```bash
pnpm --filter @workspace/db run generate
```

This creates `lib/db/drizzle/0001_<hash>.sql`. Note the exact filename.

- [ ] **Step 12: Update the migration runner so SQLite can apply referenced add-columns**

SQLite rejects `ALTER TABLE ... ADD COLUMN ... NOT NULL DEFAULT 1 REFERENCES organizations(id)` on a non-empty table while foreign keys are enabled. Drizzle's SQLite migrator starts a transaction before running migration statements, so putting `PRAGMA foreign_keys=OFF` inside the generated SQL does not work.

Update `runMigrations()` in `lib/db/src/index.ts` so FK enforcement is disabled **before** calling `migrate()`, restored in `finally`, and validated with `foreign_key_check`:

```ts
export function runMigrations(): void {
  const root = findWorkspaceRoot(process.cwd());
  const migrationsFolder = path.resolve(root, "lib/db/drizzle");
  const foreignKeysWereEnabled = sqlite.pragma("foreign_keys", { simple: true }) === 1;

  if (foreignKeysWereEnabled) sqlite.pragma("foreign_keys = OFF");
  try {
    migrate(db, { migrationsFolder });
    const violations = sqlite.pragma("foreign_key_check") as Array<Record<string, unknown>>;
    if (violations.length > 0) {
      throw new Error(`Foreign key check failed after migrations: ${JSON.stringify(violations)}`);
    }
  } finally {
    if (foreignKeysWereEnabled) sqlite.pragma("foreign_keys = ON");
  }
}
```

Do not strip `REFERENCES organizations(id)` from the migration. Disabling enforcement around the migration transaction allows SQLite to create the constraints while `foreign_key_check` verifies the migrated data before boot continues.

- [ ] **Step 13: Hand-edit and inspect the generated migration SQL**

Open the newly generated SQL file. Perform these edits:

**Edit A** — After the `CREATE TABLE \`organizations\`` statement and its `--> statement-breakpoint`, insert the demo org before any rows are backfilled:

```sql
INSERT INTO `organizations` (`id`, `name`, `status`) VALUES (1, 'عرض تجريبي', 'active');
--> statement-breakpoint
```

**Edit B** — Existing users must become org-1 users. `users.org_id` is nullable for the superadmin, so SQLite/Drizzle will not backfill it automatically. After the generated users add-column or table-rebuild statements complete, insert:

```sql
UPDATE `users` SET `org_id` = 1 WHERE `org_id` IS NULL;
--> statement-breakpoint
```

**Edit C** — Existing audit entries belong to the migrated demo business even though future platform audit entries may use `NULL`. After the generated audit-log add-column or table-rebuild statements complete, insert:

```sql
UPDATE `audit_log` SET `org_id` = 1 WHERE `org_id` IS NULL;
--> statement-breakpoint
```

**Edit D** — The `settings` table rebuild generated by Drizzle will look like:

```sql
CREATE TABLE `__new_settings` (`org_id` integer NOT NULL DEFAULT 1 ...);
INSERT INTO `__new_settings`(`org_id`, `key`, `value`) SELECT ...
```

Verify the `INSERT INTO __new_settings SELECT` line supplies `1` as `org_id` (or the literal `org_id` column if it was already added). It should look like:

```sql
INSERT INTO `__new_settings`(`org_id`, `key`, `value`) SELECT 1, `key`, `value` FROM `settings`;
```

If Drizzle generated anything different (e.g., selecting a non-existent column), fix it to match the line above.

**Edit E** — Similarly, verify the `customers` table rebuild `INSERT SELECT` supplies `1` for `org_id`:

```sql
INSERT INTO `__new_customers`(`id`, `org_id`, `name`, `phone`, `whatsapp`, `email`, `notes`, `created_at`)
  SELECT `id`, 1, `name`, `phone`, `whatsapp`, `email`, `notes`, `created_at` FROM `customers`;
```

Fix if different.

**Edit F** — Inspect every generated `ALTER TABLE ... ADD COLUMN org_id` and rebuilt-table definition:
- `products`, `accounts`, `customers`, `subscriptions`, `payments`, and `settings` must end with non-null org-1 values.
- `users` and `audit_log` may remain nullable, but all pre-existing rows must have been explicitly updated to org 1.
- Keep all generated `REFERENCES organizations(id)` clauses.

- [ ] **Step 14: Smoke-test the migration before continuing**

Test both database shapes:

1. Copy the current populated database to a throwaway path, run only `runMigrations()`, and verify:
   - migration completes without `Cannot add a REFERENCES column with non-NULL default value`;
   - `PRAGMA foreign_key_check` returns zero rows;
   - every pre-existing user and audit row has `org_id = 1`;
   - every pre-existing business row has `org_id = 1`.
2. Run the migration against an empty throwaway database and verify the same FK check succeeds.

- [ ] **Step 15: Run typecheck**

```bash
pnpm -w run typecheck
```

Expected: no errors. If errors mention `orgId` not existing on a type, the export order in `index.ts` may have a circular reference — verify `organizations.ts` is exported before tables that reference it.

- [ ] **Step 16: Commit**

```bash
git add lib/db/src/schema/ lib/db/src/index.ts lib/db/drizzle/
git commit -m "feat(db): add organizations table and orgId columns to all business tables"
```

---

## Task 2: Auth Middleware — org-aware `requireAuth` + `requireSuperadmin` + `requireOrgUser`

**Files:**
- Modify: `artifacts/api-server/src/lib/session.ts`
- Modify: `artifacts/api-server/src/lib/rbac.ts`

- [ ] **Step 1: Update `artifacts/api-server/src/lib/session.ts`** — load org in `requireAuth`, reject suspended orgs

Replace the entire file:

```ts
import { Request, Response, NextFunction } from "express";
import { db, usersTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "sam_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable is required");
  return s;
}

export interface SessionPayload {
  userId: number;
  exp: number;
}

function sign(payload: SessionPayload): string {
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString("base64url");
  const hmac = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${hmac}`;
}

function verify(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  try {
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (expectedBuf.length !== sigBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, sigBuf)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSession(res: Response, userId: number): void {
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const token = sign(payload);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS * 1000,
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }
  const payload = verify(token);
  if (!payload) {
    res.status(401).json({ error: "انتهت الجلسة، يرجى تسجيل الدخول مجددًا" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user || user.disabled) {
    res.status(401).json({ error: "المستخدم غير موجود" });
    return;
  }
  // Superadmin (orgId === null) is never suspended
  if (user.orgId !== null) {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.orgId));
    if (org?.status === "suspended") {
      res.status(401).json({ error: "تم إيقاف حسابكم — يرجى التواصل مع الإدارة" });
      return;
    }
  }
  (req as Request & { user: typeof user }).user = user;
  next();
}

export function getSessionToken(req: Request): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  return verify(token);
}
```

- [ ] **Step 2: Update `artifacts/api-server/src/lib/rbac.ts`** — add `requireSuperadmin` and `requireOrgUser`

Replace the entire file:

```ts
import type { NextFunction, Request, Response } from "express";
import { getRequestUser } from "./request-user";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).role !== "admin") {
    res.status(403).json({ error: "هذه العملية متاحة للمدير فقط" });
    return;
  }
  next();
}

/** Rejects requests from the superadmin — business routes only. */
export function requireOrgUser(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).orgId === null) {
    res.status(403).json({ error: "هذه العملية غير متاحة للمشرف العام" });
    return;
  }
  next();
}

/** Rejects requests from non-superadmin users — platform routes only. */
export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).role !== "superadmin") {
    res.status(403).json({ error: "هذه العملية متاحة للمشرف العام فقط" });
    return;
  }
  next();
}
```

Keep `requireAdmin` restricted to organization admins. Business admin routes must use middleware in this order:

```ts
requireAuth, requireOrgUser, requireAdmin
```

`requireOrgUser` is what rejects the superadmin from business routes; widening `requireAdmin` would create surprising access if it is reused without the expected guard order.

- [ ] **Step 3: Run typecheck**

```bash
pnpm -w run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/session.ts artifacts/api-server/src/lib/rbac.ts
git commit -m "feat(auth): org-aware requireAuth, add requireOrgUser + requireSuperadmin"
```

---

## Task 3: Auth Routes — register with `businessName`, login + `/auth/me` with org context

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts`

- [ ] **Step 1: Replace `artifacts/api-server/src/routes/auth.ts`** entirely

```ts
import { Router, type IRouter } from "express";
import { db, usersTable, organizationsTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setSession, clearSession, requireAuth } from "../lib/session";
import { LoginBody, RegisterBody } from "@workspace/api-zod";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!user || user.disabled) {
    if (user?.disabled) {
      db.insert(auditLogTable).values({
        orgId: user.orgId ?? undefined,
        userId: user.id,
        action: "login_failed",
        entity: "user",
        entityId: user.id,
        detail: "محاولة دخول لحساب معطل",
      }).run();
    }
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    db.insert(auditLogTable).values({
      orgId: user.orgId ?? undefined,
      userId: user.id,
      action: "login_failed",
      entity: "user",
      entityId: user.id,
      detail: "كلمة مرور خاطئة",
    }).run();
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  // Check org suspension (mirrors requireAuth — login route doesn't use requireAuth middleware)
  if (user.orgId !== null) {
    const [org] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, user.orgId));
    if (org?.status === "suspended") {
      res.status(401).json({ error: "تم إيقاف حسابكم — يرجى التواصل مع الإدارة" });
      return;
    }
  }

  setSession(res, user.id);

  db.insert(auditLogTable).values({
    orgId: user.orgId ?? undefined,
    userId: user.id,
    action: "login_success",
    entity: "user",
    entityId: user.id,
    detail: "تسجيل دخول ناجح",
  }).run();

  // Load org name for response
  const orgName = user.orgId
    ? (await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, user.orgId)))[0]?.name ?? null
    : null;

  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, orgName });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  const { name, email, password, businessName } = parsed.data;
  try {
    const { user, orgName } = db.transaction((tx) => {
      const org = tx.insert(organizationsTable)
        .values({ name: businessName, status: "active" })
        .returning()
        .get();

      const created = tx.insert(usersTable)
        .values({
          name,
          email,
          role: "admin",
          orgId: org.id,
          passwordHash: bcrypt.hashSync(password, 12),
        })
        .returning()
        .get();

      tx.insert(auditLogTable).values({
        orgId: org.id,
        userId: created.id,
        action: "user_register",
        entity: "user",
        entityId: created.id,
        detail: `تسجيل حساب جديد: ${created.name} — نشاط تجاري: ${org.name}`,
      }).run();

      return { user: created, orgName: org.name };
    });

    setSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role, orgName });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) {
      res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
      return;
    }
    throw error;
  }
});

router.post("/auth/logout", (_req, res): void => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  const orgName = user.orgId
    ? (await db.select({ name: organizationsTable.name }).from(organizationsTable).where(eq(organizationsTable.id, user.orgId)))[0]?.name ?? null
    : null;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, orgName });
});

export default router;
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm -w run typecheck
```

Expected: `RegisterBody` will complain about missing `businessName` field — this is expected; it will be fixed in Task 4 (OpenAPI + codegen). For now, cast or temporarily add `businessName` to the destructure. Alternatively, skip typecheck until after Task 4.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/auth.ts
git commit -m "feat(auth): register creates org+admin, login checks suspension, me returns orgName"
```

---

## Task 4: OpenAPI Spec + Codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Auto-updated: `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/`

- [ ] **Step 1: Add `businessName` to `RegisterInput` schema in `lib/api-spec/openapi.yaml`**

Find the `RegisterInput` schema (around line 949) and replace it:

```yaml
    RegisterInput:
      type: object
      required: [name, email, password, businessName]
      properties:
        name:
          type: string
          minLength: 1
        email:
          type: string
          format: email
        password:
          type: string
          minLength: 8
        businessName:
          type: string
          minLength: 1
```

- [ ] **Step 2: Add `orgName` to `AuthUser` schema**

Find the `AuthUser` schema (around line 963) and replace it:

```yaml
    AuthUser:
      type: object
      required: [id, name, email, role, orgName]
      properties:
        id:
          type: integer
        name:
          type: string
        email:
          type: string
        role:
          type: string
        disabled:
          type: boolean
        orgName:
          type: ["string", "null"]
```

This file is OpenAPI 3.1. Do not use `nullable: true`; use the JSON Schema union form already used elsewhere in this repository. Keep `orgName` required because every auth response explicitly returns either a string or `null`.

- [ ] **Step 3: Add `platform` tag to the tags list**

In the `tags:` array at the top of the file, add after the last tag entry:

```yaml
  - name: platform
    description: Platform admin operations (superadmin only)
```

- [ ] **Step 4: Add `PlatformOrg` schema**

At the end of the `components.schemas` section, add:

```yaml
    PlatformOrg:
      type: object
      required: [id, name, status, createdAt, ownerEmail, userCount, productCount, accountCount, customerCount, subscriptionCount, paymentCount]
      properties:
        id:
          type: integer
        name:
          type: string
        status:
          type: string
          enum: [active, suspended]
        createdAt:
          type: string
        ownerEmail:
          type: string
        userCount:
          type: integer
        productCount:
          type: integer
        accountCount:
          type: integer
        customerCount:
          type: integer
        subscriptionCount:
          type: integer
        paymentCount:
          type: integer
```

- [ ] **Step 5: Add platform paths**

In the `paths:` section, add after all existing paths (before the `components:` line):

```yaml
  # Platform admin
  /platform/orgs:
    get:
      operationId: listPlatformOrgs
      tags: [platform]
      summary: List all organizations with stats (superadmin only)
      responses:
        "200":
          description: List of organizations
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/PlatformOrg"
        "403":
          description: Forbidden
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /platform/orgs/{id}/suspend:
    post:
      operationId: suspendOrg
      tags: [platform]
      summary: Suspend an organization (superadmin only)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Suspended
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "400":
          description: Cannot suspend demo org
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Forbidden
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /platform/orgs/{id}/unsuspend:
    post:
      operationId: unsuspendOrg
      tags: [platform]
      summary: Unsuspend an organization (superadmin only)
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: Unsuspended
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "403":
          description: Forbidden
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "404":
          description: Not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

- [ ] **Step 6: Run codegen**

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: regenerates `lib/api-zod/src/generated/` (includes new `RegisterBody` with `businessName`) and `lib/api-client-react/src/generated/` (new `useListPlatformOrgs`, `useSuspendOrg`, `useUnsuspendOrg` hooks). Inspect the generated `AuthUser` type/schema and confirm `orgName` is required and represented as `string | null` / `z.string().nullable()`.

- [ ] **Step 7: Run typecheck**

```bash
pnpm -w run typecheck
```

Expected: all TypeScript errors from Tasks 2–3 resolve now that `RegisterBody` includes `businessName`.

- [ ] **Step 8: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod/ lib/api-client-react/
git commit -m "feat(api-spec): add businessName, orgName, platform endpoints; regenerate client"
```

---

## Task 5: Business Route Scoping — filter all queries by `orgId`

**Principle:** Every business route must:
1. Apply `requireAuth` + `requireOrgUser` via `router.use()` at the top (removes need for per-handler `requireAuth`)
2. Extract `orgId` with `getRequestUser(req).orgId!` (non-null is guaranteed by `requireOrgUser`)
3. Add `eq(table.orgId, orgId)` to every root-table `SELECT`, `UPDATE`, and `DELETE`
4. Verify nested resources through an org-scoped parent before reading or mutating them
5. Stamp `orgId` on every insert into a table that has an `orgId`; create slots only after an org-scoped account check

**Drizzle `WHERE` rule:** A query builder must have one composed `.where(...)`. A second `.where()` replaces the first at runtime and is normally rejected by Drizzle's standard builder types. Fold the org condition into the existing `and(...)`; do not append a second `.where()`.

**Files:**
- Modify: `artifacts/api-server/src/routes/products.ts`
- Modify: `artifacts/api-server/src/routes/accounts.ts`
- Modify: `artifacts/api-server/src/routes/customers.ts`
- Modify: `artifacts/api-server/src/routes/subscriptions.ts`
- Modify: `artifacts/api-server/src/routes/sales.ts`
- Modify: `artifacts/api-server/src/routes/dashboard.ts`
- Modify: `artifacts/api-server/src/routes/stats.ts`
- Modify: `artifacts/api-server/src/routes/expiring.ts`
- Modify: `artifacts/api-server/src/routes/reports.ts`
- Modify: `artifacts/api-server/src/routes/settings.ts`
- Modify: `artifacts/api-server/src/routes/users.ts`
- Modify: `artifacts/api-server/src/lib/settings.ts`
- Modify: `artifacts/api-server/src/lib/subscription-query.ts`
- Modify: `artifacts/api-server/src/jobs/daily-maintenance.ts`

- [ ] **Step 1: Replace `artifacts/api-server/src/routes/products.ts`** — canonical example of the scoping pattern

```ts
import { Router, type IRouter } from "express";
import { db, productsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import {
  GetProductParams,
  UpdateProductParams,
  DeleteProductParams,
  CreateProductBody,
  UpdateProductBody,
} from "@workspace/api-zod";

const router: IRouter = Router();
router.use(requireAuth, requireOrgUser);

router.get("/products", async (req, res): Promise<void> => {
  const { orgId } = getRequestUser(req);
  const products = await db.select().from(productsTable)
    .where(eq(productsTable.orgId, orgId!))
    .orderBy(productsTable.createdAt);
  res.json(products);
});

router.post("/products", async (req, res): Promise<void> => {
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { orgId } = getRequestUser(req);
  const [product] = await db.insert(productsTable)
    .values({ ...parsed.data, orgId: orgId! })
    .returning();
  res.status(201).json(product);
});

router.get("/products/:id", async (req, res): Promise<void> => {
  const params = GetProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const { orgId } = getRequestUser(req);
  const [product] = await db.select().from(productsTable)
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.orgId, orgId!)));
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(product);
});

router.patch("/products/:id", async (req, res): Promise<void> => {
  const params = UpdateProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { orgId } = getRequestUser(req);
  const [product] = await db.update(productsTable)
    .set(parsed.data)
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.orgId, orgId!)))
    .returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.json(product);
});

router.delete("/products/:id", async (req, res): Promise<void> => {
  const params = DeleteProductParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const { orgId } = getRequestUser(req);
  const [product] = await db.delete(productsTable)
    .where(and(eq(productsTable.id, params.data.id), eq(productsTable.orgId, orgId!)))
    .returning();
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }
  res.sendStatus(204);
});

export default router;
```

- [ ] **Step 2: Make `baseSubscriptionQuery` org-aware and preserve one `WHERE`**

Update `artifacts/api-server/src/lib/subscription-query.ts` so the helper owns the single composed `WHERE`:

```ts
import { and, eq, sql, type SQL } from "drizzle-orm";

export function baseSubscriptionQuery(
  orgId: number,
  ...conditions: Array<SQL | undefined>
) {
  return db
    .select(subscriptionSummary)
    .from(subscriptionsTable)
    .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(and(eq(subscriptionsTable.orgId, orgId), ...conditions));
}
```

Update all callers to pass their existing conditions into the helper instead of calling `.where()` afterward:

```ts
baseSubscriptionQuery(orgId, statusCondition("expired"), hasNoLaterSubscription);
baseSubscriptionQuery(orgId, eq(subscriptionsTable.id, id));
baseSubscriptionQuery(orgId, ...conditions);
```

`hasNoLaterSubscription` does not need a separate org predicate because a slot belongs to one account and therefore one organization; document this invariant beside the SQL fragment.

- [ ] **Step 3: Update `artifacts/api-server/src/routes/accounts.ts`**

Add `router.use(requireAuth, requireOrgUser)` and extract `orgId` in every handler. Make these exact ownership checks:

- `buildAccountWithSlots(accountId, orgId)` must load the account with `and(eq(accountsTable.id, accountId), eq(accountsTable.orgId, orgId))`. Only query its slots after that scoped account exists.
- Start the list-query `conditions` array with `eq(accountsTable.orgId, orgId)`.
- Before `POST /accounts`, verify that the submitted product belongs to the org:

```ts
const product = await db.select({ id: productsTable.id })
  .from(productsTable)
  .where(and(eq(productsTable.id, parsed.data.productId), eq(productsTable.orgId, orgId)))
  .get();
if (!product) {
  res.status(404).json({ error: "المنتج غير موجود" });
  return;
}
```

- Stamp `orgId` on the account insert.
- Scope every account update, delete, password reveal, capacity change, and slot-list parent lookup by account `id + orgId`.
- Nested slot mutations are allowed only after the account has passed the scoped parent lookup.
- Stamp `orgId` on every account-related audit entry.

- [ ] **Step 4: Update `artifacts/api-server/src/routes/customers.ts`**

Add `router.use(requireAuth, requireOrgUser)` and make `customerSubscriptions(customerId, orgId)` include `eq(subscriptionsTable.orgId, orgId)` in its existing `and(...)`.

For list/search, detail, update, and delete, compose `eq(customersTable.orgId, orgId)` into the existing single `WHERE`. For delete, the linked-subscription check must also include `subscriptionsTable.orgId = orgId`. Stamp `orgId` on customer and audit-log inserts.

Update `isUniquePhoneError()` for the composite constraint message:

```ts
error.message.includes("UNIQUE constraint failed: customers.org_id, customers.phone")
```

- [ ] **Step 5: Update `artifacts/api-server/src/routes/subscriptions.ts`**

Add `router.use(requireAuth, requireOrgUser)` and use `baseSubscriptionQuery(orgId, ...)` for list, detail, and slot-history queries.

For every notes, cancel, refund, and renew transaction:
- load the root subscription with `and(eq(subscriptionsTable.id, id), eq(subscriptionsTable.orgId, orgId))`;
- scope direct subscription updates by `id + orgId`;
- scope payment totals with `paymentsTable.orgId = orgId`;
- stamp `orgId` on refund, renewal-subscription, renewal-payment, and audit-log inserts;
- when renewal loads the slot's account, include `accountsTable.orgId = orgId` in the existing joined query.

Once the root subscription/account is scoped, slot reads and updates are safe because slots cannot be shared across accounts or organizations.

- [ ] **Step 6: Update `artifacts/api-server/src/routes/sales.ts`**

Add `router.use(requireAuth, requireOrgUser)` and extract `const { orgId } = getRequestUser(req)`.

For `GET /sales/availability`, scope both existing queries:

```ts
// Product availability query: add one WHERE after the joins.
.where(and(
  eq(productsTable.orgId, orgId!),
  eq(accountsTable.orgId, orgId!),
))

// Existing free-slots WHERE: fold both org predicates into its current and(...).
and(
  eq(accountsTable.orgId, orgId!),
  eq(productsTable.orgId, orgId!),
  eq(slotsTable.status, "free"),
  // existing account-status and expiry predicates
)
```

For `POST /sales`:

```ts
const customer = tx.select({ id: customersTable.id, name: customersTable.name })
  .from(customersTable)
  .where(and(eq(customersTable.id, input.customerId), eq(customersTable.orgId, orgId!)))
  .get();

const product = tx.select({ id: productsTable.id, name: productsTable.name })
  .from(productsTable)
  .where(and(eq(productsTable.id, input.productId), eq(productsTable.orgId, orgId!)))
  .get();
```

Fold `eq(accountsTable.orgId, orgId!)` into the existing slot query's `and(...)`; do not load the account in a second query. Stamp `orgId` on the subscription, payment, and audit-log inserts.

- [ ] **Step 7: Update `artifacts/api-server/src/routes/dashboard.ts`**

Add `router.use(requireAuth, requireOrgUser)`, extract `orgId`, and call `getSettings(orgId)`.

- Add `subscriptionsTable.orgId = orgId` to each expiring-count `and(...)`.
- Replace the overdue query with `baseSubscriptionQuery(orgId, statusCondition("expired"), hasNoLaterSubscription)`.
- In `freeSlotsByProduct`, add `accountsTable.orgId = orgId` inside the existing `leftJoin(accountsTable, and(...))` and add `productsTable.orgId = orgId` as the query's single `WHERE`. Keeping the account predicate in the join preserves products that currently have zero accounts.
- Add the relevant org predicate to each totals subquery: subscriptions, accounts, and payments.

Each query must still contain exactly one `.where(...)`.

- [ ] **Step 8: Update `artifacts/api-server/src/routes/stats.ts`**

Add `router.use(requireAuth, requireOrgUser)` before all stats routes, remove duplicate per-handler `requireAuth`, and keep the audit route as `router.get("/stats/audit-log", requireAdmin, ...)`. `requireAdmin` remains unchanged and therefore runs after `requireOrgUser`.

Products and accounts filter directly by `orgId`. Slots have no `orgId`, so count them through an org-scoped account join:

```ts
const slots = await db.select({ status: slotsTable.status })
  .from(slotsTable)
  .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
  .where(eq(accountsTable.orgId, orgId));
```

The audit-log endpoint must fold `eq(auditLogTable.orgId, orgId)` and the optional action filter into one `and(...)`.

- [ ] **Step 9: Update `artifacts/api-server/src/routes/expiring.ts` and `reports.ts`**

Both routers use `router.use(requireAuth, requireOrgUser)` and extract `orgId`.

- Expiring: call `getSettings(orgId)` and pass all date/status conditions to `baseSubscriptionQuery(orgId, ...)`.
- Reports: change `rangeWhere` to accept `orgId` and return `and(eq(paymentsTable.orgId, orgId), existing date predicates)`. Use it in every revenue query and call `getSettings(orgId)`.

- [ ] **Step 10: Make settings explicitly org-scoped**

Update `artifacts/api-server/src/lib/settings.ts`:

```ts
import { eq } from "drizzle-orm";

export async function getSettings(orgId: number): Promise<Settings> {
  const rows = await db.select().from(settingsTable)
    .where(eq(settingsTable.orgId, orgId));
  // Existing default merge and return mapping stay unchanged.
}
```

Update `artifacts/api-server/src/routes/settings.ts` with `router.use(requireAuth, requireOrgUser)`, remove duplicate per-handler `requireAuth`, and keep `requireAdmin` on both settings handlers. Call `getSettings(orgId)`, stamp settings/audit inserts, and use the composite conflict target:

```ts
tx.insert(settingsTable)
  .values({ orgId, key, value: String(value) })
  .onConflictDoUpdate({
    target: [settingsTable.orgId, settingsTable.key],
    set: { value: String(value) },
  })
  .run();
```

- [ ] **Step 11: Make daily maintenance use each organization's settings**

Update `artifacts/api-server/src/jobs/daily-maintenance.ts`. The job remains cross-org, but each org's rollover uses its own `graceDays`:

```ts
export async function runExpiryRollover(): Promise<void> {
  const orgs = await db.select({ id: organizationsTable.id }).from(organizationsTable);
  let expired = 0;
  let freed = 0;

  for (const { id: orgId } of orgs) {
    const { graceDays } = await getSettings(orgId);
    const result = db.transaction((tx) => {
      const expiredResult = tx.update(subscriptionsTable)
        .set({ status: "expired" })
        .where(and(
          eq(subscriptionsTable.orgId, orgId),
          eq(subscriptionsTable.status, "active"),
          lt(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now')`),
        )).run();

      const freedResult = tx.run(sql`
        update ${slotsTable}
        set status = 'free'
        where status = 'occupied'
          and exists (
            select 1 from ${accountsTable} owned_account
            where owned_account.id = ${slotsTable.accountId}
              and owned_account.org_id = ${orgId}
          )
          and exists (
            select 1 from ${subscriptionsTable} expired_subscription
            where expired_subscription.slot_id = ${slotsTable.id}
              and expired_subscription.org_id = ${orgId}
              and expired_subscription.status = 'expired'
              and date(expired_subscription.expiry_date, ${`+${graceDays} days`}) < date('now')
          )
          and not exists (
            select 1 from ${subscriptionsTable} active_subscription
            where active_subscription.slot_id = ${slotsTable.id}
              and active_subscription.org_id = ${orgId}
              and active_subscription.status = 'active'
          )
      `);
      return { expired: expiredResult.changes, freed: freedResult.changes };
    });
    expired += result.expired;
    freed += result.freed;
  }

  logger.info({ expired, freed }, "Daily subscription expiry rollover complete");
}
```

Add the required `organizationsTable` and `accountsTable` imports. Backups remain deployment-wide and unchanged.

- [ ] **Step 12: Update `artifacts/api-server/src/routes/users.ts`**

Use `router.use("/users", requireAuth, requireOrgUser, requireAdmin)`. Scope list, create, target lookup, update, and password-reset queries by the actor's org. Every audit insert gets the actor's `orgId`.

Demo-user protection must happen only after an org-scoped target lookup:

```ts
const orgId = getRequestUser(req).orgId!;
const targetUser = await db.select().from(usersTable)
  .where(and(eq(usersTable.id, params.data.id), eq(usersTable.orgId, orgId)))
  .get();
if (targetUser && DEMO_EMAILS.includes(targetUser.email)) {
  res.status(403).json({ error: "لا يمكن تعديل حسابات العرض التجريبي" });
  return;
}
```

Apply the same scoped lookup and guard to edit, disable, delete if present, and password reset.

- [ ] **Step 13: Audit every business route for tenant isolation**

Before typecheck, inspect every `select`, `update`, `delete`, and `insert` in the files listed in this task:

- Root resources must use their own `orgId`.
- Slots must be reached through an org-scoped account.
- Payments must be reached through an org-scoped subscription or directly filtered by `payments.orgId`.
- No query may add a second `.where()` after a helper already applied one.
- Every audit entry created by a business route must stamp the actor's `orgId`.

- [ ] **Step 14: Run typecheck**

```bash
pnpm -w run typecheck
```

Fix any type errors before committing.

- [ ] **Step 15: Commit**

```bash
git add artifacts/api-server/src/routes/ artifacts/api-server/src/lib/settings.ts artifacts/api-server/src/lib/subscription-query.ts artifacts/api-server/src/jobs/daily-maintenance.ts
git commit -m "feat(routes): scope all business queries by orgId, protect demo users"
```

---

## Task 6: Platform Admin Routes

**Files:**
- Create: `artifacts/api-server/src/routes/platform.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create `artifacts/api-server/src/routes/platform.ts`**

```ts
import { Router, type IRouter } from "express";
import {
  db, organizationsTable, usersTable,
  productsTable, accountsTable, customersTable,
  subscriptionsTable, paymentsTable,
} from "@workspace/db";
import { and, asc, count, eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireSuperadmin } from "../lib/rbac";

const router: IRouter = Router();
router.use(requireAuth, requireSuperadmin);

router.get("/platform/orgs", async (_req, res): Promise<void> => {
  const orgs = await db.select().from(organizationsTable).orderBy(asc(organizationsTable.createdAt));

  const results = await Promise.all(
    orgs.map(async (org) => {
      const [owner] = await db
        .select({ email: usersTable.email })
        .from(usersTable)
        .where(and(eq(usersTable.orgId, org.id), eq(usersTable.role, "admin")))
        .orderBy(asc(usersTable.createdAt))
        .limit(1);

      const [{ users }] = await db.select({ users: count() }).from(usersTable).where(eq(usersTable.orgId, org.id));
      const [{ products }] = await db.select({ products: count() }).from(productsTable).where(eq(productsTable.orgId, org.id));
      const [{ accounts }] = await db.select({ accounts: count() }).from(accountsTable).where(eq(accountsTable.orgId, org.id));
      const [{ customers }] = await db.select({ customers: count() }).from(customersTable).where(eq(customersTable.orgId, org.id));
      const [{ subscriptions }] = await db.select({ subscriptions: count() }).from(subscriptionsTable).where(eq(subscriptionsTable.orgId, org.id));
      const [{ payments }] = await db.select({ payments: count() }).from(paymentsTable).where(eq(paymentsTable.orgId, org.id));

      return {
        id: org.id,
        name: org.name,
        status: org.status,
        createdAt: org.createdAt,
        ownerEmail: owner?.email ?? "",
        userCount: users,
        productCount: products,
        accountCount: accounts,
        customerCount: customers,
        subscriptionCount: subscriptions,
        paymentCount: payments,
      };
    }),
  );

  res.json(results);
});

router.post("/platform/orgs/:id/suspend", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  if (id === 1) {
    res.status(400).json({ error: "لا يمكن إيقاف المنظمة التجريبية" });
    return;
  }
  const [org] = await db
    .update(organizationsTable)
    .set({ status: "suspended" })
    .where(eq(organizationsTable.id, id))
    .returning();
  if (!org) {
    res.status(404).json({ error: "المنظمة غير موجودة" });
    return;
  }
  res.json({ ok: true });
});

router.post("/platform/orgs/:id/unsuspend", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const [org] = await db
    .update(organizationsTable)
    .set({ status: "active" })
    .where(eq(organizationsTable.id, id))
    .returning();
  if (!org) {
    res.status(404).json({ error: "المنظمة غير موجودة" });
    return;
  }
  res.json({ ok: true });
});

export default router;
```

- [ ] **Step 2: Register platform router in `artifacts/api-server/src/routes/index.ts`**

```ts
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import productsRouter from "./products";
import accountsRouter from "./accounts";
import statsRouter from "./stats";
import customersRouter from "./customers";
import salesRouter from "./sales";
import subscriptionsRouter from "./subscriptions";
import dashboardRouter from "./dashboard";
import expiringRouter from "./expiring";
import settingsRouter from "./settings";
import usersRouter from "./users";
import reportsRouter from "./reports";
import platformRouter from "./platform";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(productsRouter);
router.use(accountsRouter);
router.use(statsRouter);
router.use(customersRouter);
router.use(salesRouter);
router.use(subscriptionsRouter);
router.use(dashboardRouter);
router.use(expiringRouter);
router.use(settingsRouter);
router.use(usersRouter);
router.use(reportsRouter);
router.use(platformRouter);

export default router;
```

- [ ] **Step 3: Run typecheck**

```bash
pnpm -w run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add artifacts/api-server/src/routes/platform.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(platform): add superadmin org management endpoints"
```

---

## Task 7: Boot Sequence — demo org reset + platform admin

**Files:**
- Modify: `artifacts/api-server/src/seed.ts`
- Modify: `artifacts/api-server/src/index.ts`

**Intentional destructive first production boot:** Task 1's migration inserts org 1 before application boot. Therefore the first production boot after deploying multi-tenancy will treat org 1 as existing, wipe all migrated org-1 business data and non-protected org-1 users, then replace it with the canonical rich demo seed. This is required by the approved auto-reset demo behavior, but it means the current live data is not preserved after boot.

Before the first production deployment:
- take and verify a restorable database backup;
- explicitly confirm that replacing the current live data with the demo seed is intended;
- do not deploy if the current data must be retained.

- [ ] **Step 1: Replace `artifacts/api-server/src/seed.ts`** entirely

```ts
import {
  db,
  usersTable,
  organizationsTable,
  productsTable,
  accountsTable,
  slotsTable,
  customersTable,
  subscriptionsTable,
  paymentsTable,
  settingsTable,
  auditLogTable,
} from "@workspace/db";
import { and, eq, notInArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { encrypt } from "./lib/crypto";
import { logger } from "./lib/logger";

const DEMO_ORG_ID = 1;
const DEMO_ADMIN_EMAIL = "admin@example.com";
const DEMO_STAFF_EMAIL = "staff@example.com";

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function isoDateTime(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

// ── Demo data specs (same as before) ─────────────────────────────────────────

const PRODUCTS = [
  { name: "نتفليكس بريميوم — مشترك", service: "Netflix", defaultCapacity: 5, defaultDurationDays: 30, defaultPrice: 15, notes: "حساب مشترك 5 مقاعد" },
  { name: "سبوتيفاي عائلي — مشترك", service: "Spotify", defaultCapacity: 6, defaultDurationDays: 30, defaultPrice: 8, notes: "حساب عائلي 6 مقاعد" },
  { name: "شاهد VIP — مشترك", service: "Shahid", defaultCapacity: 4, defaultDurationDays: 30, defaultPrice: 10, notes: "باقة VIP رياضة وترفيه" },
  { name: "شات جي بي تي بلس — كامل", service: "ChatGPT", defaultCapacity: 1, defaultDurationDays: 30, defaultPrice: 25, notes: "حساب كامل غير مشترك" },
  { name: "ديزني بلس — مشترك", service: "Disney+", defaultCapacity: 4, defaultDurationDays: 30, defaultPrice: 12, notes: "حساب مشترك 4 مقاعد" },
  { name: "يوتيوب بريميوم عائلي", service: "YouTube", defaultCapacity: 5, defaultDurationDays: 30, defaultPrice: 7, notes: "باقة عائلية" },
];

const ACCOUNTS: {
  productIdx: number; label: string; email: string; capacity: number;
  startOffset: number; expiryOffset: number;
  status: "active" | "disabled" | "needs_attention"; notes?: string;
}[] = [
  { productIdx: 0, label: "نتفليكس #1", email: "nf.demo1@example.com", capacity: 5, startOffset: -25, expiryOffset: 5, status: "active", notes: "ينتهي قريباً — جدد الاشتراك" },
  { productIdx: 0, label: "نتفليكس #2", email: "nf.demo2@example.com", capacity: 5, startOffset: -10, expiryOffset: 20, status: "active" },
  { productIdx: 1, label: "سبوتيفاي #1", email: "sp.demo1@example.com", capacity: 6, startOffset: -15, expiryOffset: 15, status: "active" },
  { productIdx: 1, label: "سبوتيفاي #2", email: "sp.demo2@example.com", capacity: 6, startOffset: -5, expiryOffset: 25, status: "active" },
  { productIdx: 2, label: "شاهد #1", email: "sh.demo1@example.com", capacity: 4, startOffset: -20, expiryOffset: 10, status: "active" },
  { productIdx: 3, label: "شات جي بي تي #1", email: "gpt.demo1@example.com", capacity: 1, startOffset: -8, expiryOffset: 22, status: "active" },
  { productIdx: 3, label: "شات جي بي تي #2", email: "gpt.demo2@example.com", capacity: 1, startOffset: -32, expiryOffset: -2, status: "needs_attention", notes: "انتهت صلاحية الحساب" },
  { productIdx: 4, label: "ديزني #1", email: "dp.demo1@example.com", capacity: 4, startOffset: -12, expiryOffset: 18, status: "active" },
  { productIdx: 5, label: "يوتيوب #1", email: "yt.demo1@example.com", capacity: 5, startOffset: -18, expiryOffset: 12, status: "active" },
  { productIdx: 5, label: "يوتيوب #2", email: "yt.demo2@example.com", capacity: 5, startOffset: -3, expiryOffset: 27, status: "active" },
];

const CUSTOMERS = [
  { name: "أحمد الزعبي", phone: "0791234501", whatsapp: "0791234501" },
  { name: "محمد العمري", phone: "0791234502", whatsapp: "0791234502", email: "m.omari@example.com" },
  { name: "سارة الخطيب", phone: "0791234503" },
  { name: "ليان حداد", phone: "0791234504", whatsapp: "0791234504" },
  { name: "عمر الرواشدة", phone: "0791234505", notes: "عميل دائم — خصم 10%" },
  { name: "نور عبيدات", phone: "0791234506", email: "nour.ob@example.com" },
  { name: "خالد المومني", phone: "0791234507", whatsapp: "0791234507" },
  { name: "رنا الشريف", phone: "0791234508" },
  { name: "يوسف النجار", phone: "0791234509", whatsapp: "0791234509" },
  { name: "هبة قاسم", phone: "0791234510" },
  { name: "طارق السعدي", phone: "0791234511", notes: "يفضل الدفع بالتحويل" },
  { name: "دانا عوض", phone: "0791234512", whatsapp: "0791234512" },
  { name: "معاذ الخالدي", phone: "0791234513" },
  { name: "لينا صالح", phone: "0791234514", email: "lina.s@example.com" },
  { name: "حسن عواد", phone: "0791234515" },
  { name: "آية الترك", phone: "0791234516", whatsapp: "0791234516" },
  { name: "فادي حمدان", phone: "0791234517" },
  { name: "ريم البطاينة", phone: "0791234518", whatsapp: "0791234518" },
  { name: "زيد الكيلاني", phone: "0791234519" },
  { name: "مرام ياسين", phone: "0791234520", notes: "عميلة جديدة" },
];

const SUBSCRIPTIONS: {
  accountIdx: number; slotIndex: number; customerIdx: number;
  startOffset: number; expiryOffset: number;
  status: "active" | "expired" | "cancelled";
}[] = [
  { accountIdx: 0, slotIndex: 1, customerIdx: 0, startOffset: -27, expiryOffset: 3, status: "active" },
  { accountIdx: 0, slotIndex: 2, customerIdx: 1, startOffset: -26, expiryOffset: 4, status: "active" },
  { accountIdx: 4, slotIndex: 1, customerIdx: 2, startOffset: -25, expiryOffset: 5, status: "active" },
  { accountIdx: 8, slotIndex: 1, customerIdx: 3, startOffset: -24, expiryOffset: 6, status: "active" },
  { accountIdx: 2, slotIndex: 1, customerIdx: 4, startOffset: -23, expiryOffset: 7, status: "active" },
  { accountIdx: 0, slotIndex: 3, customerIdx: 5, startOffset: -20, expiryOffset: 10, status: "active" },
  { accountIdx: 2, slotIndex: 2, customerIdx: 6, startOffset: -18, expiryOffset: 12, status: "active" },
  { accountIdx: 4, slotIndex: 2, customerIdx: 7, startOffset: -16, expiryOffset: 14, status: "active" },
  { accountIdx: 1, slotIndex: 1, customerIdx: 8, startOffset: -15, expiryOffset: 15, status: "active" },
  { accountIdx: 8, slotIndex: 2, customerIdx: 9, startOffset: -12, expiryOffset: 18, status: "active" },
  { accountIdx: 1, slotIndex: 2, customerIdx: 10, startOffset: -10, expiryOffset: 20, status: "active" },
  { accountIdx: 5, slotIndex: 1, customerIdx: 11, startOffset: -9, expiryOffset: 21, status: "active" },
  { accountIdx: 7, slotIndex: 1, customerIdx: 12, startOffset: -6, expiryOffset: 24, status: "active" },
  { accountIdx: 3, slotIndex: 1, customerIdx: 13, startOffset: -5, expiryOffset: 25, status: "active" },
  { accountIdx: 7, slotIndex: 2, customerIdx: 14, startOffset: -3, expiryOffset: 27, status: "active" },
  { accountIdx: 9, slotIndex: 1, customerIdx: 15, startOffset: -1, expiryOffset: 29, status: "active" },
  { accountIdx: 3, slotIndex: 2, customerIdx: 16, startOffset: -2, expiryOffset: 40, status: "active" },
  { accountIdx: 9, slotIndex: 2, customerIdx: 17, startOffset: -1, expiryOffset: 45, status: "active" },
  { accountIdx: 0, slotIndex: 1, customerIdx: 18, startOffset: -90, expiryOffset: -60, status: "expired" },
  { accountIdx: 0, slotIndex: 2, customerIdx: 19, startOffset: -85, expiryOffset: -55, status: "expired" },
  { accountIdx: 2, slotIndex: 1, customerIdx: 0, startOffset: -75, expiryOffset: -45, status: "expired" },
  { accountIdx: 4, slotIndex: 1, customerIdx: 1, startOffset: -70, expiryOffset: -40, status: "expired" },
  { accountIdx: 6, slotIndex: 1, customerIdx: 2, startOffset: -65, expiryOffset: -35, status: "expired" },
  { accountIdx: 8, slotIndex: 1, customerIdx: 3, startOffset: -60, expiryOffset: -30, status: "expired" },
  { accountIdx: 1, slotIndex: 1, customerIdx: 4, startOffset: -50, expiryOffset: -20, status: "expired" },
  { accountIdx: 7, slotIndex: 1, customerIdx: 5, startOffset: -40, expiryOffset: -10, status: "expired" },
  { accountIdx: 1, slotIndex: 3, customerIdx: 6, startOffset: -30, expiryOffset: 0, status: "cancelled" },
  { accountIdx: 8, slotIndex: 3, customerIdx: 7, startOffset: -25, expiryOffset: 5, status: "cancelled" },
  { accountIdx: 9, slotIndex: 3, customerIdx: 8, startOffset: -20, expiryOffset: 10, status: "cancelled" },
  { accountIdx: 4, slotIndex: 3, customerIdx: 9, startOffset: -15, expiryOffset: 15, status: "cancelled" },
];

// ── Boot functions ────────────────────────────────────────────────────────────

async function ensurePlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? "platform@example.com";
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "platform123";

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!existing) {
    await db.insert(usersTable).values({
      name: "المشرف العام",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "superadmin",
      orgId: null,
    });
    logger.info({ email }, "Platform admin created");
  } else if (existing.role !== "superadmin" || existing.orgId !== null) {
    throw new Error(`PLATFORM_ADMIN_EMAIL conflicts with an existing organization user: ${email}`);
  } else {
    await db.update(usersTable)
      .set({ passwordHash: await bcrypt.hash(password, 12), disabled: false })
      .where(eq(usersTable.id, existing.id));
  }
}

async function ensureDemoOrg(): Promise<void> {
  const [existing] = await db.select().from(organizationsTable).where(eq(organizationsTable.id, DEMO_ORG_ID));
  if (existing) return;
  await db.insert(organizationsTable).values({ id: DEMO_ORG_ID, name: "عرض تجريبي", status: "active" });
  logger.info("Demo org created");
}

async function wipeDemoOrg(): Promise<void> {
  // Delete in FK dependency order; slots cascade from accounts
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, DEMO_ORG_ID));
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.orgId, DEMO_ORG_ID));
  await db.delete(accountsTable).where(eq(accountsTable.orgId, DEMO_ORG_ID)); // cascades to slots
  await db.delete(customersTable).where(eq(customersTable.orgId, DEMO_ORG_ID));
  await db.delete(productsTable).where(eq(productsTable.orgId, DEMO_ORG_ID));
  await db.delete(settingsTable).where(eq(settingsTable.orgId, DEMO_ORG_ID));
  await db.delete(auditLogTable).where(eq(auditLogTable.orgId, DEMO_ORG_ID));
  await db.delete(usersTable).where(
    and(
      eq(usersTable.orgId, DEMO_ORG_ID),
      notInArray(usersTable.email, [DEMO_ADMIN_EMAIL, DEMO_STAFF_EMAIL]),
    ),
  );
  // Reset demo user passwords and re-enable them
  const adminHash = await bcrypt.hash("admin123", 12);
  const staffHash = await bcrypt.hash("staff123", 12);
  await db.update(usersTable).set({ passwordHash: adminHash, disabled: false }).where(eq(usersTable.email, DEMO_ADMIN_EMAIL));
  await db.update(usersTable).set({ passwordHash: staffHash, disabled: false }).where(eq(usersTable.email, DEMO_STAFF_EMAIL));
  logger.info("Demo org wiped and demo passwords reset");
}

async function ensureDemoUsers(): Promise<void> {
  const adminHash = await bcrypt.hash("admin123", 12);
  const staffHash = await bcrypt.hash("staff123", 12);
  const [existingAdmin] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_ADMIN_EMAIL));
  if (!existingAdmin) {
    await db.insert(usersTable).values({ name: "مدير النظام", email: DEMO_ADMIN_EMAIL, passwordHash: adminHash, role: "admin", orgId: DEMO_ORG_ID });
  } else {
    await db.update(usersTable).set({ role: "admin", orgId: DEMO_ORG_ID }).where(eq(usersTable.id, existingAdmin.id));
  }
  const [existingStaff] = await db.select().from(usersTable).where(eq(usersTable.email, DEMO_STAFF_EMAIL));
  if (!existingStaff) {
    await db.insert(usersTable).values({ name: "موظف تجريبي", email: DEMO_STAFF_EMAIL, passwordHash: staffHash, role: "staff", orgId: DEMO_ORG_ID });
  } else {
    await db.update(usersTable).set({ role: "staff", orgId: DEMO_ORG_ID }).where(eq(usersTable.id, existingStaff.id));
  }
}

async function seedDemoData(): Promise<void> {
  await ensureDemoUsers();

  const products = await db.insert(productsTable)
    .values(PRODUCTS.map((p) => ({ ...p, orgId: DEMO_ORG_ID })))
    .returning();

  const accountIds: number[] = [];
  const slotIdByAccountAndIndex = new Map<string, number>();
  for (const spec of ACCOUNTS) {
    const product = products[spec.productIdx]!;
    const [account] = await db.insert(accountsTable).values({
      orgId: DEMO_ORG_ID,
      productId: product.id,
      label: spec.label,
      email: spec.email,
      passwordEncrypted: encrypt("DemoPass123!"),
      capacity: spec.capacity,
      status: spec.status,
      startDate: isoDate(spec.startOffset),
      expiryDate: isoDate(spec.expiryOffset),
      notes: spec.notes,
    }).returning();
    accountIds.push(account!.id);

    const slotValues = Array.from({ length: spec.capacity }, (_, i) => ({
      accountId: account!.id,
      slotIndex: i + 1,
      status: "free" as const,
    }));
    const slots = await db.insert(slotsTable).values(slotValues).returning();
    for (const slot of slots) {
      slotIdByAccountAndIndex.set(`${accountIds.length - 1}:${slot.slotIndex}`, slot.id);
    }
  }

  const customers = await db.insert(customersTable)
    .values(CUSTOMERS.map((c) => ({ ...c, orgId: DEMO_ORG_ID })))
    .returning();

  let paymentCount = 0;
  for (const [i, spec] of SUBSCRIPTIONS.entries()) {
    const slotId = slotIdByAccountAndIndex.get(`${spec.accountIdx}:${spec.slotIndex}`)!;
    const customer = customers[spec.customerIdx]!;
    const product = products[ACCOUNTS[spec.accountIdx]!.productIdx]!;
    const price = product.defaultPrice;

    const [subscription] = await db.insert(subscriptionsTable).values({
      orgId: DEMO_ORG_ID,
      slotId,
      customerId: customer.id,
      startDate: isoDate(spec.startOffset),
      expiryDate: isoDate(spec.expiryOffset),
      price,
      status: spec.status,
    }).returning();

    if (spec.status === "active") {
      await db.update(slotsTable).set({ status: "occupied" }).where(eq(slotsTable.id, slotId));
    }

    const payments = [
      {
        orgId: DEMO_ORG_ID,
        subscriptionId: subscription!.id,
        amount: price,
        method: (i % 2 === 0 ? "cash" : "transfer") as "cash" | "transfer",
        paidAt: isoDateTime(spec.startOffset),
      },
    ];
    if (i % 3 === 0) {
      payments.push({ orgId: DEMO_ORG_ID, subscriptionId: subscription!.id, amount: price, method: "transfer" as const, paidAt: isoDateTime(spec.startOffset - 30) });
    }
    if (i % 5 === 0) {
      payments.push({ orgId: DEMO_ORG_ID, subscriptionId: subscription!.id, amount: price, method: "cash" as const, paidAt: isoDateTime(spec.startOffset - 90) });
    }
    await db.insert(paymentsTable).values(payments);
    paymentCount += payments.length;
  }

  logger.info({ products: products.length, accounts: ACCOUNTS.length, customers: customers.length, subscriptions: SUBSCRIPTIONS.length, payments: paymentCount }, "Demo data seeded");
}

// ── Exports ───────────────────────────────────────────────────────────────────

/** Production boot: platform admin → ensure demo org → always wipe org 1 → reseed. */
export async function bootSequence(): Promise<void> {
  await ensurePlatformAdmin();
  await ensureDemoOrg();
  await wipeDemoOrg();
  await seedDemoData();
}

/** Dev boot: ensure demo org + users exist; never wipes. */
export async function devSeed(): Promise<void> {
  await ensurePlatformAdmin();
  await ensureDemoOrg();
  await ensureDemoUsers();
}
```

- [ ] **Step 2: Update `artifacts/api-server/src/index.ts`** — validate new env vars, call boot sequence

Replace the entire file:

```ts
import app from "./app";
import { logger } from "./lib/logger";
import { startDailyMaintenance } from "./jobs/daily-maintenance";
import { bootSequence, devSeed } from "./seed";
import { runMigrations } from "@workspace/db";

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required but was not provided.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

if (!process.env["SESSION_SECRET"]) throw new Error("SESSION_SECRET environment variable is required.");

const encKey = process.env["ENCRYPTION_KEY"];
if (!encKey) throw new Error("ENCRYPTION_KEY environment variable is required.");
if (Buffer.from(encKey, "hex").length !== 32)
  throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes).");

if (process.env.NODE_ENV === "production") {
  if (!process.env["PLATFORM_ADMIN_EMAIL"]) throw new Error("PLATFORM_ADMIN_EMAIL is required in production.");
  if (!process.env["PLATFORM_ADMIN_PASSWORD"]) throw new Error("PLATFORM_ADMIN_PASSWORD is required in production.");
  runMigrations();
  logger.info("Database migrations applied");
  await bootSequence();
} else {
  await devSeed();
}

startDailyMaintenance();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});
```

- [ ] **Step 3: Verify first-boot and restart behavior against throwaway databases**

Run a production-mode smoke test against:

1. A copy of the current populated database:
   - migrations succeed;
   - migrated current rows are assigned to org 1 before boot;
   - production boot intentionally wipes them and installs the rich demo seed;
   - protected demo users remain/reset correctly;
   - `PRAGMA foreign_key_check` returns zero rows.
2. A database containing org 1 plus a second organization:
   - production restart wipes/reseeds only org 1;
   - org 2 users, settings, and business data remain unchanged.

- [ ] **Step 4: Run typecheck**

```bash
pnpm -w run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/seed.ts artifacts/api-server/src/index.ts
git commit -m "feat(boot): demo org auto-reset on every production start, platform admin from env"
```

---

## Task 8: Frontend — `businessName` field on registration form

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/login.tsx`
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`

- [ ] **Step 1: Add `businessName` string key to `artifacts/accounts-manager/src/lib/strings.ts`**

In the `auth` object, add:

```ts
businessName: "اسم النشاط التجاري",
businessNamePlaceholder: "أدخل اسم نشاطك التجاري",
```

- [ ] **Step 2: Update `artifacts/accounts-manager/src/pages/login.tsx`** — add `businessName` state and field

Add state at the top of the `Login` component (after the existing state declarations):

```ts
const [businessName, setBusinessName] = useState("");
```

In the `switchMode` function, reset it:

```ts
const switchMode = () => {
  setMode(isRegister ? "login" : "register");
  setError(null);
  setConfirmPassword("");
  setBusinessName(""); // add this line
};
```

In the `handleSubmit` function, pass `businessName` to `registerMutation`:

```ts
registerMutation.mutate(
  { data: { name, email, password, businessName } },
  {
    onSuccess: (data) => onAuthSuccess(data, strings.auth.registerSuccess),
    onError: (err: any) => onAuthError(err, strings.auth.registerError),
  }
);
```

Add the form field — inside the `{isRegister && (...)}` block, after the name field and before the email field:

```tsx
{isRegister && (
  <div className="space-y-2">
    <Label htmlFor="businessName">{strings.auth.businessName}</Label>
    <Input
      id="businessName"
      type="text"
      placeholder={strings.auth.businessNamePlaceholder}
      value={businessName}
      onChange={(e) => setBusinessName(e.target.value)}
      required
      data-testid="input-business-name"
    />
  </div>
)}
```

Place this field between the name field and the email field in the form.

- [ ] **Step 3: Run typecheck**

```bash
pnpm -w run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add artifacts/accounts-manager/src/pages/login.tsx artifacts/accounts-manager/src/lib/strings.ts
git commit -m "feat(ui): add businessName field to registration form"
```

---

## Task 9: Frontend — sidebar `orgName` + superadmin platform page

**Files:**
- Modify: `artifacts/accounts-manager/src/components/layout.tsx`
- Create: `artifacts/accounts-manager/src/pages/platform.tsx`
- Modify: `artifacts/accounts-manager/src/App.tsx`
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`

- [ ] **Step 1: Update `artifacts/accounts-manager/src/components/layout.tsx`** — use `user.orgName` for sidebar header

Find the line:
```ts
const businessName = dashboard?.businessName || strings.app.title;
```

Replace it with:
```ts
const businessName = user?.orgName || strings.app.title;
```

Remove the `useGetDashboard` import and its hook call if `dashboard` is not used anywhere else in the file. (Check the rest of the file before removing — `dashboard` may still be used for expiry counts or other data.)

- [ ] **Step 2: Add platform strings to `artifacts/accounts-manager/src/lib/strings.ts`**

Add a `platform` key at the top level of the `strings` object:

```ts
platform: {
  title: "لوحة المشرف العام",
  organizations: "الجهات التجارية",
  orgName: "اسم الجهة",
  status: "الحالة",
  ownerEmail: "البريد الإلكتروني للمدير",
  users: "المستخدمون",
  products: "المنتجات",
  accounts: "الحسابات",
  customers: "العملاء",
  subscriptions: "الاشتراكات",
  payments: "المدفوعات",
  active: "نشط",
  suspended: "موقوف",
  suspend: "إيقاف",
  unsuspend: "إلغاء الإيقاف",
  confirmSuspend: "هل أنت متأكد من إيقاف هذه الجهة؟",
  confirmUnsuspend: "هل أنت متأكد من إلغاء إيقاف هذه الجهة؟",
},
```

- [ ] **Step 3: Create `artifacts/accounts-manager/src/pages/platform.tsx`**

```tsx
import { useListPlatformOrgs, useSuspendOrg, useUnsuspendOrg } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function Platform() {
  const { data: orgs, isLoading } = useListPlatformOrgs();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const suspendMutation = useSuspendOrg();
  const unsuspendMutation = useUnsuspendOrg();

  const refetch = () => queryClient.invalidateQueries({ queryKey: ["/api/platform/orgs"] });

  const handleSuspend = (id: number) => {
    suspendMutation.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: strings.platform.suspended }); refetch(); },
        onError: (err: any) => toast({ title: err?.response?.data?.error ?? "خطأ", variant: "destructive" }),
      },
    );
  };

  const handleUnsuspend = (id: number) => {
    unsuspendMutation.mutate(
      { id },
      {
        onSuccess: () => { toast({ title: strings.platform.active }); refetch(); },
        onError: (err: any) => toast({ title: err?.response?.data?.error ?? "خطأ", variant: "destructive" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4" dir="rtl">
      <h1 className="text-2xl font-bold">{strings.platform.title}</h1>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>{strings.platform.orgName}</TableHead>
            <TableHead>{strings.platform.status}</TableHead>
            <TableHead>{strings.platform.ownerEmail}</TableHead>
            <TableHead>{strings.platform.users}</TableHead>
            <TableHead>{strings.platform.products}</TableHead>
            <TableHead>{strings.platform.accounts}</TableHead>
            <TableHead>{strings.platform.customers}</TableHead>
            <TableHead>{strings.platform.subscriptions}</TableHead>
            <TableHead>{strings.platform.payments}</TableHead>
            <TableHead>{strings.app.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orgs?.map((org) => (
            <TableRow key={org.id}>
              <TableCell>{org.id}</TableCell>
              <TableCell className="font-medium">{org.name}</TableCell>
              <TableCell>
                <Badge variant={org.status === "active" ? "default" : "destructive"}>
                  {org.status === "active" ? strings.platform.active : strings.platform.suspended}
                </Badge>
              </TableCell>
              <TableCell dir="ltr">{org.ownerEmail}</TableCell>
              <TableCell>{org.userCount}</TableCell>
              <TableCell>{org.productCount}</TableCell>
              <TableCell>{org.accountCount}</TableCell>
              <TableCell>{org.customerCount}</TableCell>
              <TableCell>{org.subscriptionCount}</TableCell>
              <TableCell>{org.paymentCount}</TableCell>
              <TableCell>
                {org.id !== 1 && (
                  org.status === "active" ? (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="destructive" size="sm" disabled={suspendMutation.isPending}>
                          {strings.platform.suspend}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{strings.platform.confirmSuspend}</AlertDialogTitle>
                          <AlertDialogDescription>{strings.platform.confirmSuspend}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel>
                          <AlertDialogAction className="bg-destructive" onClick={() => handleSuspend(org.id)}>
                            {strings.platform.suspend}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={unsuspendMutation.isPending}>
                          {strings.platform.unsuspend}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>{strings.platform.confirmUnsuspend}</AlertDialogTitle>
                          <AlertDialogDescription>{strings.platform.confirmUnsuspend}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>{strings.app.cancel}</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleUnsuspend(org.id)}>
                            {strings.platform.unsuspend}
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Update `artifacts/accounts-manager/src/App.tsx`** — superadmin-only routing

Add the import:

```ts
import Platform from "@/pages/platform";
```

Replace the `Router` function with one that redirects superadmins to the platform page:

```tsx
function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;

  // Superadmin sees only the platform page
  if (user?.role === "superadmin") {
    return (
      <Switch>
        <Route path="/login" component={Login} />
        <Route>
          <AuthGuard>
            <Platform />
          </AuthGuard>
        </Route>
      </Switch>
    );
  }

  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/">
        <AuthGuard>
          <Dashboard />
        </AuthGuard>
      </Route>
      <Route path="/inventory">
        <AuthGuard>
          <Inventory />
        </AuthGuard>
      </Route>
      <Route path="/products">
        <AuthGuard>
          <Inventory />
        </AuthGuard>
      </Route>
      <Route path="/accounts">
        <AuthGuard>
          <Inventory />
        </AuthGuard>
      </Route>
      <Route path="/customers/:id">
        {(params) => <AuthGuard><CustomerDetail id={Number(params.id)} /></AuthGuard>}
      </Route>
      <Route path="/customers"><AuthGuard><Customers /></AuthGuard></Route>
      <Route path="/subscriptions/:id">
        {(params) => <AuthGuard><SubscriptionDetail id={Number(params.id)} /></AuthGuard>}
      </Route>
      <Route path="/subscriptions"><AuthGuard><Subscriptions /></AuthGuard></Route>
      <Route path="/sale/new"><AuthGuard><NewSale /></AuthGuard></Route>
      <Route path="/expiring"><AuthGuard><Expiring /></AuthGuard></Route>
      <Route path="/admin/settings"><AuthGuard><AdminGuard><Settings /></AdminGuard></AuthGuard></Route>
      <Route path="/admin/users"><AuthGuard><AdminGuard><Users /></AdminGuard></AuthGuard></Route>
      <Route path="/admin/audit"><AuthGuard><AdminGuard><Audit /></AdminGuard></AuthGuard></Route>
      <Route component={NotFound} />
    </Switch>
  );
}
```

Add `useAuth` import at the top:

```ts
import { useAuth } from "@/lib/auth";
```

- [ ] **Step 5: Run typecheck**

```bash
pnpm -w run typecheck
```

Fix any issues — common ones: `useSuspendOrg` and `useUnsuspendOrg` may need different argument shapes (check the generated hook signatures in `lib/api-client-react/src/generated/`). Match the actual generated hook API.

- [ ] **Step 6: Commit**

```bash
git add artifacts/accounts-manager/src/
git commit -m "feat(ui): sidebar shows orgName, superadmin sees platform page with org management"
```

---

## Task 10: Deployment — env vars + `deploy.cmd` update

**Files:**
- Modify: `.env.example`
- Modify: `deploy.cmd`

- [ ] **Step 1: Update `.env.example`** — add platform admin vars

Add these two lines to `.env.example` (near the existing `ADMIN_EMAIL`/`ADMIN_PASSWORD` lines):

```
PLATFORM_ADMIN_EMAIL=platform@example.com
PLATFORM_ADMIN_PASSWORD=change-me-before-deploy
```

- [ ] **Step 2: Update `deploy.cmd`** — generate random platform password on first deploy

Open `deploy.cmd`. Find the section where secrets are written or the closing summary is printed.

Add logic to generate and persist the platform admin password if not already set. The pattern matches how other secrets are handled in the file. Look for `.deploy-secrets` file handling and add:

```cmd
REM Platform admin password — generated once, never overwritten
IF NOT EXIST .deploy-secrets (
    echo. > .deploy-secrets
)

findstr /C:"PLATFORM_ADMIN_PASSWORD" .deploy-secrets >nul 2>&1
IF ERRORLEVEL 1 (
    FOR /F "tokens=*" %%G IN ('powershell -Command "[System.Web.Security.Membership]::GeneratePassword(24,4)"') DO SET PLATFORM_PASS=%%G
    echo PLATFORM_ADMIN_PASSWORD=!PLATFORM_PASS! >> .deploy-secrets
    echo PLATFORM_ADMIN_EMAIL=platform@example.com >> .deploy-secrets
)

FOR /F "tokens=2 delims==" %%G IN ('findstr "PLATFORM_ADMIN_PASSWORD" .deploy-secrets') DO SET PLATFORM_PASS=%%G
FOR /F "tokens=2 delims==" %%G IN ('findstr "PLATFORM_ADMIN_EMAIL" .deploy-secrets') DO SET PLATFORM_EMAIL=%%G
```

Then in the deploy command that creates the container, pass the two additional env vars:
```cmd
--env PLATFORM_ADMIN_EMAIL=%PLATFORM_EMAIL% ^
--env PLATFORM_ADMIN_PASSWORD=%PLATFORM_PASS% ^
```

And in the closing summary, print:
```cmd
echo Platform admin email:    %PLATFORM_EMAIL%
echo Platform admin password: %PLATFORM_PASS%
```

Note: Read the actual `deploy.cmd` file before editing to see the exact pattern used for existing secret generation.

- [ ] **Step 3: Run final typecheck**

```bash
pnpm -w run typecheck
```

Expected: clean.

- [ ] **Step 4: Run the final tenant-isolation smoke test**

Against a throwaway production-mode database:

1. Boot and verify org 1 contains the canonical demo seed.
2. Register org A and org B. Give them distinct settings and create products, accounts, customers, sales, subscriptions, and payments in both.
3. While authenticated as org A, attempt to list, read, update, delete, sell against, renew, refund, reveal, and report on org B resource IDs. Every attempt must return no org-B data and must not mutate org B.
4. Verify `/sales/availability`, dashboard, stats, expiring, reports, settings, users, and audit-log results contain only the current org's data.
5. Run `runExpiryRollover()` with different grace settings for org A and org B; verify each org uses its own value.
6. Log in as superadmin and verify every business route returns 403 while `/api/platform/*` succeeds.
7. Restart production mode and verify org 1 is reset while org A and org B remain unchanged.
8. Run `PRAGMA foreign_key_check`; it must return zero rows.

- [ ] **Step 5: Commit**

```bash
git add .env.example deploy.cmd
git commit -m "feat(deploy): add PLATFORM_ADMIN_EMAIL/PASSWORD env vars and auto-generation in deploy.cmd"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| Public sign-up creates a business, owner becomes admin | Task 3 (register route) |
| Demo business = org #1, demo login works forever | Task 7 (boot sequence, demo user guard) |
| Demo auto-reset on container restart | Task 7 (wipeDemoOrg + seedDemoData) |
| Platform admin: superadmin role, null orgId | Task 2 (requireSuperadmin), Task 7 (ensurePlatformAdmin) |
| Platform admin sees all orgs with counts | Task 6 (GET /platform/orgs) |
| Suspend/unsuspend orgs (not demo org) | Task 6 (suspend/unsuspend routes) |
| Suspension blocks login | Task 2 (requireAuth suspension check), Task 3 (login route) |
| Referenced orgId columns migrate on populated SQLite DB | Task 1 (migration runner + populated-DB smoke test) |
| Existing users and audit rows become org 1 | Task 1 (explicit migration backfills) |
| orgId stamped on all business/audit inserts | Task 1 (schema) + Task 5 (route scoping) |
| settings composite PK (orgId, key) | Task 1 (schema) + Task 5 (settings route) |
| settings helper and maintenance are per-org | Task 5 (`getSettings(orgId)` + daily maintenance loop) |
| customers composite unique (orgId, phone) | Task 1 (schema) |
| users.orgId nullable, superadmin = null | Task 1 (schema) |
| users.role gains superadmin | Task 1 (schema) |
| requireAuth loads org per request | Task 2 (session.ts) |
| Business routes return 403 for superadmin | Task 2 (requireOrgUser) + Task 5 |
| /platform/* returns 403 for non-superadmin | Task 2 (requireSuperadmin) + Task 6 |
| Register gains businessName | Task 3 (auth route), Task 4 (OpenAPI), Task 8 (UI) |
| AuthUser gains orgName | Task 3 (/auth/me), Task 4 (OpenAPI) |
| Sidebar shows orgName | Task 9 (layout.tsx) |
| Superadmin sees only platform page | Task 9 (App.tsx) |
| Demo users protected from edit/delete/pwd-reset | Task 5 (users route) |
| First production boot intentionally replaces migrated org-1 data | Task 7 (deployment gate + boot smoke test) |
| Cross-org reads and writes are rejected | Task 5 audit + Task 10 final isolation smoke test |
| deploy.cmd generates platform password | Task 10 |
| PLATFORM_ADMIN_EMAIL/PASSWORD env vars | Task 7 (index.ts), Task 10 (.env.example, deploy.cmd) |

**Typecheck sequence:** Tasks 1–3 will have type errors until Task 4 (codegen) resolves them. It's fine to skip per-task typechecks and run a single `pnpm -w run typecheck` after Task 4 is complete to verify the full picture.
