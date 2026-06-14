import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import XlsxPopulate from "xlsx-populate";
import {
  organizationsTable, productsTable, accountsTable, slotsTable,
  customersTable, subscriptionsTable, paymentsTable,
} from "@workspace/db/schema";
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
