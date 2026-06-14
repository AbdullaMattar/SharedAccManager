import { describe, it, expect, beforeAll } from "vitest";
import XlsxPopulate from "xlsx-populate";
import { buildWorkbookBuffer } from "../backup-export";
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
    expect(wb.sheet("الحسابات").usedRange()!.value().flat()).toContain("pw-A");
  });

  it("cannot be opened with the wrong passphrase", async () => {
    const buffer = await buildWorkbookBuffer(data, "my passphrase");
    await expect(XlsxPopulate.fromDataAsync(buffer, { password: "nope" })).rejects.toBeTruthy();
  });
});
