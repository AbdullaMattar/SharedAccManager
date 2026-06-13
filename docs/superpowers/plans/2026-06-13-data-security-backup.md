# Data Security — Per-Org Encrypted Backup Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org admin download a password-protected `.xlsx` backup containing only their own organization's data (customers, subscriptions, payments, accounts incl. decrypted provider passwords), from a new "امن البيانات" (Data Security) page.

**Architecture:** A new admin-guarded endpoint `POST /api/backup/export` reads `orgId` from the session (never the client), collects that org's rows via Drizzle, decrypts account passwords with the existing `crypto.ts`, builds a workbook, and AES-encrypts it with a customer-chosen passphrase using `xlsx-populate`'s native "password to open". The frontend adds a Data Security page with a passphrase modal that fetches the file as a blob and saves it.

**Tech Stack:** Express 5, Drizzle ORM + better-sqlite3, `xlsx-populate` (workbook build + AES encryption, pure JS so it bundles under esbuild), `vitest` (new — first test harness in the repo), React 19 + Wouter + shadcn/Radix UI.

---

## Design notes that shape the tasks

- **Multi-tenant firewall:** every query filters `eq(table.orgId, orgId)` and `orgId` comes from `getRequestUser(req).orgId!`. The cross-tenant isolation test (Task 2) is the most important correctness check.
- **Dependency injection for testability:** `collectOrgData(database, orgId)` and `exportOrgBackup(database, orgId, passphrase)` take a Drizzle instance as their first argument. The route passes the singleton `db` from `@workspace/db`; tests pass an in-memory Drizzle instance. This avoids fighting the `@workspace/db` singleton (which connects to a file on import).
- **No test runner exists yet.** Task 1 stands up `vitest` *and* de-risks the encryption library in one go — if `xlsx-populate` can't round-trip an encrypted file, switch to `exceljs` (build) + `officecrypto-tool` (encrypt) before continuing.
- **Pages self-wrap in `<Layout>`** (App.tsx renders pages directly inside guards, without Layout), so the new page renders `<Layout>...</Layout>` like the others.

## File Structure

**New files:**
- `artifacts/api-server/vitest.config.ts` — vitest config (node env, inline `@workspace/*`)
- `artifacts/api-server/src/lib/__tests__/xlsx-crypto.spike.test.ts` — lib + harness spike
- `artifacts/api-server/src/lib/backup-export.ts` — data collection, workbook build, encrypt, compose
- `artifacts/api-server/src/lib/__tests__/backup-export.test.ts` — isolation + content tests
- `artifacts/api-server/src/routes/backup.ts` — `POST /backup/export`
- `artifacts/accounts-manager/src/pages/data-security.tsx` — page + passphrase modal

**Modified files:**
- `artifacts/api-server/package.json` — add `xlsx-populate` dep, `vitest` devDep, `test` script
- `artifacts/api-server/src/routes/index.ts` — register backup router
- `artifacts/api-server/src/app.ts` — apply `sensitiveLimiter` to the export route
- `artifacts/accounts-manager/src/lib/phase3-api.ts` — `downloadBackup()` blob helper
- `artifacts/accounts-manager/src/lib/strings.ts` — `dataSecurity` string group
- `artifacts/accounts-manager/src/App.tsx` — `/admin/data-security` route
- `artifacts/accounts-manager/src/components/layout.tsx` — admin nav item

---

## Task 1: Test harness + encryption library spike

**Files:**
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/vitest.config.ts`
- Test: `artifacts/api-server/src/lib/__tests__/xlsx-crypto.spike.test.ts`

- [ ] **Step 1: Install xlsx-populate + vitest**

Run (from repo root):
```bash
pnpm --filter @workspace/api-server add xlsx-populate
pnpm --filter @workspace/api-server add -D vitest
```
Expected: both added; `xlsx-populate` under `dependencies`, `vitest` under `devDependencies` in `artifacts/api-server/package.json`.

- [ ] **Step 2: Add the `test` script**

In `artifacts/api-server/package.json`, add to `scripts`:
```json
"test": "vitest run"
```

- [ ] **Step 3: Create the vitest config**

Create `artifacts/api-server/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // @workspace/* packages ship raw .ts via package "exports"; inline them so
    // Vite transforms them instead of treating them as pre-built node_modules.
    server: { deps: { inline: [/@workspace\//] } },
  },
});
```

- [ ] **Step 4: Write the spike test (round-trip encrypt/decrypt + wrong password)**

Create `artifacts/api-server/src/lib/__tests__/xlsx-crypto.spike.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import XlsxPopulate from "xlsx-populate";

describe("xlsx-populate encryption round-trip", () => {
  const passphrase = "correct horse";

  it("encrypts and re-reads with the right passphrase", async () => {
    const wb = await XlsxPopulate.fromBlankAsync();
    wb.sheet(0).name("test").cell("A1").value("hello");
    const buffer = (await wb.outputAsync({ password: passphrase })) as Buffer;
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    const reopened = await XlsxPopulate.fromDataAsync(buffer, { password: passphrase });
    expect(reopened.sheet("test").cell("A1").value()).toBe("hello");
  });

  it("rejects the wrong passphrase", async () => {
    const wb = await XlsxPopulate.fromBlankAsync();
    wb.sheet(0).cell("A1").value("secret");
    const buffer = (await wb.outputAsync({ password: passphrase })) as Buffer;
    await expect(XlsxPopulate.fromDataAsync(buffer, { password: "wrong" })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 5: Run the spike**

Run (from repo root):
```bash
pnpm --filter @workspace/api-server test
```
Expected: PASS (2 passed). This proves both the harness and the library work.

> **If it fails** because `xlsx-populate` cannot encrypt/decrypt in Node 22: stop and switch the encryption approach to `exceljs` for building + `officecrypto-tool` for `encrypt(buffer, { password, type: "xlsx" })`, then update Task 3 accordingly. Do not proceed until a round-trip passes.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/package.json artifacts/api-server/vitest.config.ts artifacts/api-server/src/lib/__tests__/xlsx-crypto.spike.test.ts pnpm-lock.yaml
git commit -m "test(api): add vitest harness and verify xlsx encryption round-trip"
```

---

## Task 2: Collect a single org's data (with cross-tenant isolation test)

**Files:**
- Create: `artifacts/api-server/src/lib/backup-export.ts`
- Test: `artifacts/api-server/src/lib/__tests__/backup-export.test.ts`

- [ ] **Step 1: Write the failing isolation + content test**

Create `artifacts/api-server/src/lib/__tests__/backup-export.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// crypto reads ENCRYPTION_KEY lazily at call time — set it before importing anything that encrypts.
process.env.ENCRYPTION_KEY = "00".repeat(32);

import {
  organizationsTable, productsTable, accountsTable, slotsTable,
  customersTable, subscriptionsTable, paymentsTable,
} from "@workspace/db/schema";
import { encrypt } from "../crypto";
import { collectOrgData } from "../backup-export";

function makeDb(): BetterSQLite3Database<any> {
  const sqlite = new Database(":memory:");
  const migrationsFolder = path.resolve(import.meta.dirname, "../../../../../lib/db/drizzle");
  const database = drizzle(sqlite);
  sqlite.pragma("foreign_keys = OFF");
  migrate(database, { migrationsFolder });
  sqlite.pragma("foreign_keys = ON");
  return database;
}

async function seedOrg(
  database: BetterSQLite3Database<any>,
  tag: string,
): Promise<number> {
  const [org] = await database.insert(organizationsTable).values({ name: `org-${tag}` }).returning();
  const [product] = await database.insert(productsTable).values({ orgId: org.id, name: `product-${tag}`, service: "netflix" }).returning();
  const [account] = await database.insert(accountsTable).values({
    orgId: org.id, productId: product.id, label: `account-${tag}`,
    email: `acc-${tag}@example.com`, passwordEncrypted: encrypt(`pw-${tag}`),
    capacity: 1, startDate: "2026-01-01", expiryDate: "2026-12-31",
  }).returning();
  const [slot] = await database.insert(slotsTable).values({ accountId: account.id, slotIndex: 1, status: "occupied" }).returning();
  const [customer] = await database.insert(customersTable).values({ orgId: org.id, name: `customer-${tag}`, phone: `phone-${tag}` }).returning();
  const [sub] = await database.insert(subscriptionsTable).values({
    orgId: org.id, slotId: slot.id, customerId: customer.id,
    startDate: "2026-01-01", expiryDate: "2026-02-01", price: 10, status: "active",
  }).returning();
  await database.insert(paymentsTable).values({ orgId: org.id, subscriptionId: sub.id, amount: 10, method: "cash", paidAt: "2026-01-01" });
  return org.id;
}

describe("collectOrgData", () => {
  let database: BetterSQLite3Database<any>;
  let orgA: number;

  beforeAll(async () => {
    database = makeDb();
    orgA = await seedOrg(database, "A");
    await seedOrg(database, "B");
  });

  it("returns only the requested org's data (no cross-tenant leakage)", async () => {
    const data = await collectOrgData(database, orgA);
    const blob = JSON.stringify(data);
    expect(blob).toContain("-A");
    expect(blob).not.toContain("-B");
    expect(data.customers).toHaveLength(1);
    expect(data.accounts).toHaveLength(1);
    expect(data.subscriptions).toHaveLength(1);
    expect(data.payments).toHaveLength(1);
  });

  it("decrypts the account password into plaintext", async () => {
    const data = await collectOrgData(database, orgA);
    expect(data.accounts[0].password).toBe("pw-A");
    expect(data.orgName).toBe("org-A");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @workspace/api-server test`
Expected: FAIL — `collectOrgData` is not exported from `../backup-export` (module/function not found).

- [ ] **Step 3: Implement `collectOrgData` + the data type**

Create `artifacts/api-server/src/lib/backup-export.ts`:
```ts
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  organizationsTable, productsTable, accountsTable, slotsTable,
  customersTable, subscriptionsTable, paymentsTable,
} from "@workspace/db";
import { decrypt } from "./crypto";

export interface OrgBackupData {
  orgName: string | null;
  exportedAt: string;
  customers: { name: string; phone: string; whatsapp: string | null; email: string | null; notes: string | null; createdAt: string }[];
  subscriptions: { customerName: string; customerPhone: string; productName: string; accountLabel: string; slotIndex: number; startDate: string; expiryDate: string; price: number; status: string }[];
  payments: { paidAt: string; amount: number; method: string; customerName: string; productName: string }[];
  accounts: { productName: string; label: string; email: string; password: string; capacity: number; status: string; startDate: string; expiryDate: string; notes: string | null }[];
}

export async function collectOrgData(
  database: BetterSQLite3Database<any>,
  orgId: number,
): Promise<OrgBackupData> {
  const [org] = await database
    .select({ name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));

  const customers = await database
    .select({
      name: customersTable.name, phone: customersTable.phone, whatsapp: customersTable.whatsapp,
      email: customersTable.email, notes: customersTable.notes, createdAt: customersTable.createdAt,
    })
    .from(customersTable)
    .where(eq(customersTable.orgId, orgId))
    .orderBy(customersTable.createdAt);

  const subscriptions = await database
    .select({
      customerName: customersTable.name, customerPhone: customersTable.phone,
      productName: productsTable.name, accountLabel: accountsTable.label, slotIndex: slotsTable.slotIndex,
      startDate: subscriptionsTable.startDate, expiryDate: subscriptionsTable.expiryDate,
      price: subscriptionsTable.price, status: subscriptionsTable.status,
    })
    .from(subscriptionsTable)
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .where(eq(subscriptionsTable.orgId, orgId))
    .orderBy(subscriptionsTable.createdAt);

  const payments = await database
    .select({
      paidAt: paymentsTable.paidAt, amount: paymentsTable.amount, method: paymentsTable.method,
      customerName: customersTable.name, productName: productsTable.name,
    })
    .from(paymentsTable)
    .innerJoin(subscriptionsTable, eq(paymentsTable.subscriptionId, subscriptionsTable.id))
    .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(eq(paymentsTable.orgId, orgId))
    .orderBy(paymentsTable.paidAt);

  const accountRows = await database
    .select({
      productName: productsTable.name, label: accountsTable.label, email: accountsTable.email,
      passwordEncrypted: accountsTable.passwordEncrypted, capacity: accountsTable.capacity,
      status: accountsTable.status, startDate: accountsTable.startDate,
      expiryDate: accountsTable.expiryDate, notes: accountsTable.notes,
    })
    .from(accountsTable)
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(eq(accountsTable.orgId, orgId))
    .orderBy(accountsTable.createdAt);

  const accounts = accountRows.map(({ passwordEncrypted, ...rest }) => ({
    ...rest,
    password: decrypt(passwordEncrypted),
  }));

  return {
    orgName: org?.name ?? null,
    exportedAt: new Date().toISOString(),
    customers,
    subscriptions,
    payments,
    accounts,
  };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (spike 2 + collectOrgData 2 = 4 passed).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/backup-export.ts artifacts/api-server/src/lib/__tests__/backup-export.test.ts
git commit -m "feat(api): collect per-org backup data with cross-tenant isolation test"
```

---

## Task 3: Build + encrypt the workbook

**Files:**
- Modify: `artifacts/api-server/src/lib/backup-export.ts`
- Test: `artifacts/api-server/src/lib/__tests__/backup-export.test.ts`

- [ ] **Step 1: Write the failing workbook test**

Append to `artifacts/api-server/src/lib/__tests__/backup-export.test.ts`:
```ts
import XlsxPopulate from "xlsx-populate";
import { buildWorkbookBuffer } from "../backup-export";

describe("buildWorkbookBuffer", () => {
  const data = {
    orgName: "org-A",
    exportedAt: "2026-06-13T00:00:00.000Z",
    customers: [{ name: "customer-A", phone: "phone-A", whatsapp: null, email: null, notes: null, createdAt: "2026-01-01" }],
    subscriptions: [{ customerName: "customer-A", customerPhone: "phone-A", productName: "product-A", accountLabel: "account-A", slotIndex: 1, startDate: "2026-01-01", expiryDate: "2026-02-01", price: 10, status: "active" }],
    payments: [{ paidAt: "2026-01-01", amount: 10, method: "cash", customerName: "customer-A", productName: "product-A" }],
    accounts: [{ productName: "product-A", label: "account-A", email: "acc-A@example.com", password: "pw-A", capacity: 1, status: "active", startDate: "2026-01-01", expiryDate: "2026-12-31", notes: null }],
  };

  it("produces an encrypted workbook readable with the passphrase", async () => {
    const buffer = await buildWorkbookBuffer(data, "my passphrase");
    const wb = await XlsxPopulate.fromDataAsync(buffer, { password: "my passphrase" });
    expect(wb.sheets().map((s: any) => s.name())).toEqual(
      expect.arrayContaining(["ملخص", "العملاء", "الاشتراكات", "المدفوعات", "الحسابات"]),
    );
    // the decrypted account password is present in the Accounts sheet
    expect(wb.sheet("الحسابات").usedRange()!.value().flat()).toContain("pw-A");
  });

  it("cannot be opened with the wrong passphrase", async () => {
    const buffer = await buildWorkbookBuffer(data, "my passphrase");
    await expect(XlsxPopulate.fromDataAsync(buffer, { password: "nope" })).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @workspace/api-server test`
Expected: FAIL — `buildWorkbookBuffer` is not exported.

- [ ] **Step 3: Implement `buildWorkbookBuffer` + `exportOrgBackup`**

Append to `artifacts/api-server/src/lib/backup-export.ts`:
```ts
import XlsxPopulate from "xlsx-populate";

type Matrix = (string | number)[][];

function addSheet(wb: any, name: string, headers: string[], rows: Matrix): void {
  const sheet = wb.addSheet(name);
  sheet.cell("A1").value([headers, ...rows]);
}

export async function buildWorkbookBuffer(data: OrgBackupData, passphrase: string): Promise<Buffer> {
  const wb = await XlsxPopulate.fromBlankAsync();

  wb.sheet(0).name("ملخص").cell("A1").value([
    ["النشاط", data.orgName ?? ""],
    ["تاريخ التصدير", data.exportedAt],
    ["عدد العملاء", data.customers.length],
    ["عدد الاشتراكات", data.subscriptions.length],
    ["عدد المدفوعات", data.payments.length],
    ["عدد الحسابات", data.accounts.length],
    ["تنبيه", "هذا الملف محمي بكلمة مرور ويحتوي على كلمات مرور الحسابات. احتفظ به في مكان آمن. لا يمكن استرجاع كلمة المرور إذا فُقدت."],
  ]);

  addSheet(wb, "العملاء",
    ["الاسم", "الهاتف", "واتساب", "البريد", "ملاحظات", "تاريخ الإضافة"],
    data.customers.map((c) => [c.name, c.phone, c.whatsapp ?? "", c.email ?? "", c.notes ?? "", c.createdAt]));

  addSheet(wb, "الاشتراكات",
    ["العميل", "هاتف العميل", "المنتج", "الحساب", "المقعد", "تاريخ البداية", "تاريخ الانتهاء", "السعر", "الحالة"],
    data.subscriptions.map((s) => [s.customerName, s.customerPhone, s.productName, s.accountLabel, s.slotIndex, s.startDate, s.expiryDate, s.price, s.status]));

  addSheet(wb, "المدفوعات",
    ["التاريخ", "المبلغ", "طريقة الدفع", "العميل", "المنتج"],
    data.payments.map((p) => [p.paidAt, p.amount, p.method, p.customerName, p.productName]));

  addSheet(wb, "الحسابات",
    ["المنتج", "الاسم", "البريد", "كلمة المرور", "السعة", "الحالة", "تاريخ البداية", "تاريخ الانتهاء", "ملاحظات"],
    data.accounts.map((a) => [a.productName, a.label, a.email, a.password, a.capacity, a.status, a.startDate, a.expiryDate, a.notes ?? ""]));

  return (await wb.outputAsync({ password: passphrase })) as Buffer;
}

export async function exportOrgBackup(
  database: BetterSQLite3Database<any>,
  orgId: number,
  passphrase: string,
): Promise<{ buffer: Buffer; orgName: string | null }> {
  const data = await collectOrgData(database, orgId);
  const buffer = await buildWorkbookBuffer(data, passphrase);
  return { buffer, orgName: data.orgName };
}
```

Note: add `import XlsxPopulate from "xlsx-populate";` to the top of the file with the other imports (shown above mid-file only for clarity). `BetterSQLite3Database` is already imported at the top from Task 2 — do not duplicate it.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (6 passed total).

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/lib/backup-export.ts artifacts/api-server/src/lib/__tests__/backup-export.test.ts
git commit -m "feat(api): build and AES-encrypt per-org backup workbook"
```

---

## Task 4: The export endpoint

**Files:**
- Create: `artifacts/api-server/src/routes/backup.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/app.ts`

- [ ] **Step 1: Create the route**

Create `artifacts/api-server/src/routes/backup.ts`:
```ts
import { Router, type IRouter } from "express";
import { db, auditLogTable } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { requireOrgUser, requireAdmin } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import { exportOrgBackup } from "../lib/backup-export";

const router: IRouter = Router();

router.use("/backup", requireAuth, requireOrgUser, requireAdmin);

router.post("/backup/export", async (req, res): Promise<void> => {
  const passphrase = typeof req.body?.passphrase === "string" ? req.body.passphrase : "";
  if (passphrase.length < 8) {
    res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
    return;
  }

  const user = getRequestUser(req);
  const orgId = user.orgId!;

  try {
    const { buffer, orgName } = await exportOrgBackup(db, orgId, passphrase);

    await db.insert(auditLogTable).values({
      userId: user.id,
      orgId,
      action: "data_export",
      entity: "organization",
      entityId: orgId,
      detail: "تنزيل نسخة احتياطية مشفّرة",
    });

    const date = new Date().toISOString().slice(0, 10);
    const safe = (orgName ?? "backup").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="backup-${date}.xlsx"; filename*=UTF-8''backup-${encodeURIComponent(safe)}-${date}.xlsx`,
    );
    res.send(buffer);
  } catch (err) {
    req.log?.error({ err }, "data export failed");
    res.status(500).json({ error: "تعذّر إنشاء النسخة الاحتياطية" });
  }
});

export default router;
```

- [ ] **Step 2: Register the router**

In `artifacts/api-server/src/routes/index.ts`, add the import alongside the others:
```ts
import backupRouter from "./backup";
```
and register it (after `platformRouter`):
```ts
router.use(backupRouter);
```

- [ ] **Step 3: Rate-limit the export endpoint**

In `artifacts/api-server/src/app.ts`, after the existing line
`app.use("/api/accounts/:id/reveal-password", sensitiveLimiter);` add:
```ts
app.use("/api/backup/export", sensitiveLimiter);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/backup.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/app.ts
git commit -m "feat(api): add POST /api/backup/export endpoint (admin, org-scoped, rate-limited)"
```

---

## Task 5: Frontend — strings + blob download helper

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`
- Modify: `artifacts/accounts-manager/src/lib/phase3-api.ts`

- [ ] **Step 1: Add the strings group**

In `artifacts/accounts-manager/src/lib/strings.ts`, add a `dataSecurity` group to the exported `strings` object (match the existing nested-object style, all Arabic/RTL):
```ts
dataSecurity: {
  nav: "امن البيانات",
  title: "امن البيانات",
  intro: "نزّل نسخة احتياطية مشفّرة من بيانات نشاطك التجاري كاملةً.",
  downloadButton: "تنزيل نسخة احتياطية",
  warning: "الملف محمي بكلمة مرور تختارها ويحتوي على كلمات مرور الحسابات. احتفظ به في مكان آمن — لا يمكن استرجاع كلمة المرور إذا فُقدت.",
  modalTitle: "تنزيل نسخة احتياطية مشفّرة",
  passphraseLabel: "كلمة مرور الملف",
  confirmLabel: "تأكيد كلمة المرور",
  tooShort: "كلمة المرور يجب أن تكون 8 أحرف على الأقل",
  mismatch: "كلمتا المرور غير متطابقتين",
  generating: "جارٍ التحضير…",
  success: "تم تنزيل النسخة الاحتياطية",
  error: "تعذّر إنشاء النسخة الاحتياطية، حاول مجددًا",
},
```

- [ ] **Step 2: Add the download helper**

Append to `artifacts/accounts-manager/src/lib/phase3-api.ts`:
```ts
export async function downloadBackup(passphrase: string): Promise<void> {
  const response = await fetch("/api/backup/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passphrase }),
  });
  if (!response.ok) throw new Error(await response.text());

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? "backup.xlsx";

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/accounts-manager run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/accounts-manager/src/lib/strings.ts artifacts/accounts-manager/src/lib/phase3-api.ts
git commit -m "feat(web): add data-security strings and backup download helper"
```

---

## Task 6: Frontend — Data Security page, route, and nav

**Files:**
- Create: `artifacts/accounts-manager/src/pages/data-security.tsx`
- Modify: `artifacts/accounts-manager/src/App.tsx`
- Modify: `artifacts/accounts-manager/src/components/layout.tsx`

- [ ] **Step 1: Create the page**

Create `artifacts/accounts-manager/src/pages/data-security.tsx`:
```tsx
import { useState } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { DatabaseBackup, Loader2 } from "lucide-react";
import { downloadBackup } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export default function DataSecurity() {
  const s = strings.dataSecurity;
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const tooShort = passphrase.length < 8;
  const mismatch = confirm.length > 0 && passphrase !== confirm;
  const canSubmit = !tooShort && passphrase === confirm && !busy;

  const handleDownload = async () => {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await downloadBackup(passphrase);
      toast({ title: s.success });
      setOpen(false);
      setPassphrase("");
      setConfirm("");
    } catch {
      toast({ title: s.error, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{s.title}</h1>
          <p className="text-muted-foreground mt-1">{s.intro}</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DatabaseBackup className="h-5 w-5" />
              {s.downloadButton}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{s.warning}</p>
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button data-testid="btn-open-backup">
                  <DatabaseBackup className="h-4 w-4 me-2" />
                  {s.downloadButton}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{s.modalTitle}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">{s.warning}</p>
                  <div className="space-y-2">
                    <Label htmlFor="bk-pass">{s.passphraseLabel}</Label>
                    <Input id="bk-pass" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} data-testid="input-passphrase" />
                    {passphrase.length > 0 && tooShort && <p className="text-xs text-destructive">{s.tooShort}</p>}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="bk-confirm">{s.confirmLabel}</Label>
                    <Input id="bk-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="input-confirm" />
                    {mismatch && <p className="text-xs text-destructive">{s.mismatch}</p>}
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleDownload} disabled={!canSubmit} data-testid="btn-download-backup">
                    {busy ? <Loader2 className="h-4 w-4 me-2 animate-spin" /> : <DatabaseBackup className="h-4 w-4 me-2" />}
                    {busy ? s.generating : s.downloadButton}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
```

- [ ] **Step 2: Add the route**

In `artifacts/accounts-manager/src/App.tsx`, add the import next to the other page imports:
```tsx
import DataSecurity from "@/pages/data-security";
```
and add the route next to the other `/admin/*` routes:
```tsx
<Route path="/admin/data-security"><AuthGuard><OrgGuard><AdminGuard><DataSecurity /></AdminGuard></OrgGuard></AuthGuard></Route>
```

- [ ] **Step 3: Add the nav item**

In `artifacts/accounts-manager/src/components/layout.tsx`:
- add `DatabaseBackup` to the `lucide-react` import line.
- in the `user?.role === "admin"` nav array, add:
```tsx
{ href: "/admin/data-security", label: strings.dataSecurity.nav, icon: DatabaseBackup },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/accounts-manager run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/accounts-manager/src/pages/data-security.tsx artifacts/accounts-manager/src/App.tsx artifacts/accounts-manager/src/components/layout.tsx
git commit -m "feat(web): add Data Security page with passphrase-protected backup download"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the whole test suite**

Run: `pnpm --filter @workspace/api-server test`
Expected: PASS (6 passed).

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm run typecheck`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `pnpm run build`
Expected: api-server bundles to `dist/index.mjs` (xlsx-populate bundled, no "unbundleable" error) and the web app builds.

- [ ] **Step 4: Manual end-to-end check**

Start the API + web app (per CONTEXT.md dev commands, with `PORT`, `SESSION_SECRET`, `ENCRYPTION_KEY` set), log in as an org admin, open **امن البيانات**, enter a passphrase + confirmation, download. Then:
- Open the `.xlsx` in Excel and Google Sheets with the passphrase → confirm 5 sheets, Arabic headers, your org's rows, decrypted account passwords.
- Try the wrong passphrase → rejected.
- Confirm a `data_export` row appears in the audit log.
- Confirm a non-admin (staff) user does not see the nav item and `POST /api/backup/export` returns 403 for them.

- [ ] **Step 5: Final commit (if any manual fixes were needed)**

```bash
git add -A
git commit -m "chore: data-security backup verification fixes"
```

---

## Self-review notes

- **Spec coverage:** scope/who (Tasks 4,6 guards) ✓; sheets incl. decrypted passwords (Task 3) ✓; passphrase 8+ both sides (Task 4 server, Task 6 client) ✓; audit entry (Task 4) ✓; rate limit (Task 4) ✓; org-from-session firewall + isolation test (Tasks 2,4) ✓; download blob mechanism (Task 5) ✓; new page/route/nav (Task 6) ✓; encryption lib confirmation (Task 1) ✓.
- **Out of scope confirmed absent:** no Google Drive, no restore/import, no scheduling, no platform-admin export.
- **Type consistency:** `collectOrgData` / `buildWorkbookBuffer` / `exportOrgBackup` signatures and `OrgBackupData` shape are identical across Tasks 2–4 and the route. `downloadBackup` name matches between Task 5 (definition) and Task 6 (usage).
- **Phase 2 (later, not in this plan):** Google Drive connect (`drive.file`), encrypted refresh-token storage, nightly auto-push on the same page.
