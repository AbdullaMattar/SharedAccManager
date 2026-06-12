import {
  accountsTable,
  auditLogTable,
  customersTable,
  db,
  organizationsTable,
  paymentsTable,
  productsTable,
  settingsTable,
  slotsTable,
  subscriptionsTable,
  usersTable,
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

async function ensureDemoUser(
  name: string,
  email: string,
  password: string,
  role: "admin" | "staff",
): Promise<void> {
  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!existing) {
    await db.insert(usersTable).values({
      name,
      email,
      passwordHash,
      role,
      orgId: DEMO_ORG_ID,
      disabled: false,
    });
    return;
  }

  await db.update(usersTable)
    .set({
      name,
      passwordHash,
      role,
      orgId: DEMO_ORG_ID,
      disabled: false,
    })
    .where(eq(usersTable.id, existing.id));
}

async function ensurePlatformAdmin(): Promise<void> {
  const email = process.env.PLATFORM_ADMIN_EMAIL ?? "platform@example.com";
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? "platform123";
  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!existing) {
    await db.insert(usersTable).values({
      name: "Platform Admin",
      email,
      passwordHash,
      role: "superadmin",
      orgId: null,
      disabled: false,
    });
    logger.info({ email }, "Platform admin created");
    return;
  }

  if (existing.role !== "superadmin" || existing.orgId !== null) {
    throw new Error(`Existing user ${email} must be role=superadmin with orgId=NULL`);
  }

  await db.update(usersTable)
    .set({ name: "Platform Admin", passwordHash, disabled: false })
    .where(eq(usersTable.id, existing.id));
}

async function ensureDemoOrg(): Promise<void> {
  const [existing] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, DEMO_ORG_ID));

  if (existing) return;

  await db.insert(organizationsTable).values({
    id: DEMO_ORG_ID,
    name: "Demo Organization",
    status: "active",
  });
}

async function ensureDemoUsers(): Promise<void> {
  await ensureDemoUser("Demo Admin", DEMO_ADMIN_EMAIL, "admin123", "admin");
  await ensureDemoUser("Demo Staff", DEMO_STAFF_EMAIL, "staff123", "staff");
}

async function wipeDemoOrg(): Promise<void> {
  await db.delete(paymentsTable).where(eq(paymentsTable.orgId, DEMO_ORG_ID));
  await db.delete(subscriptionsTable).where(eq(subscriptionsTable.orgId, DEMO_ORG_ID));
  await db.delete(accountsTable).where(eq(accountsTable.orgId, DEMO_ORG_ID));
  await db.delete(customersTable).where(eq(customersTable.orgId, DEMO_ORG_ID));
  await db.delete(productsTable).where(eq(productsTable.orgId, DEMO_ORG_ID));
  await db.delete(settingsTable).where(eq(settingsTable.orgId, DEMO_ORG_ID));
  await db.delete(auditLogTable).where(eq(auditLogTable.orgId, DEMO_ORG_ID));
  await db.delete(usersTable).where(and(
    eq(usersTable.orgId, DEMO_ORG_ID),
    notInArray(usersTable.email, [DEMO_ADMIN_EMAIL, DEMO_STAFF_EMAIL]),
  ));
}

const PRODUCTS = [
  { name: "Netflix Premium Shared", service: "Netflix", defaultCapacity: 5, defaultDurationDays: 30, defaultPrice: 15, notes: "5 seats" },
  { name: "Spotify Family Shared", service: "Spotify", defaultCapacity: 6, defaultDurationDays: 30, defaultPrice: 8, notes: "6 seats" },
  { name: "Shahid VIP Shared", service: "Shahid", defaultCapacity: 4, defaultDurationDays: 30, defaultPrice: 10, notes: "VIP package" },
  { name: "ChatGPT Solo", service: "ChatGPT", defaultCapacity: 1, defaultDurationDays: 30, defaultPrice: 25, notes: "Single seat" },
  { name: "Disney Plus Shared", service: "Disney+", defaultCapacity: 4, defaultDurationDays: 30, defaultPrice: 12, notes: "4 seats" },
  { name: "YouTube Family", service: "YouTube", defaultCapacity: 5, defaultDurationDays: 30, defaultPrice: 7, notes: "Family package" },
] as const;

const ACCOUNTS: Array<{
  productIdx: number;
  label: string;
  email: string;
  capacity: number;
  startOffset: number;
  expiryOffset: number;
  status: "active" | "disabled" | "needs_attention";
  notes?: string;
}> = [
  { productIdx: 0, label: "Netflix #1", email: "nf.demo1@example.com", capacity: 5, startOffset: -25, expiryOffset: 5, status: "active" as const, notes: "Renews soon" },
  { productIdx: 0, label: "Netflix #2", email: "nf.demo2@example.com", capacity: 5, startOffset: -10, expiryOffset: 20, status: "active" as const },
  { productIdx: 1, label: "Spotify #1", email: "sp.demo1@example.com", capacity: 6, startOffset: -15, expiryOffset: 15, status: "active" as const },
  { productIdx: 1, label: "Spotify #2", email: "sp.demo2@example.com", capacity: 6, startOffset: -5, expiryOffset: 25, status: "active" as const },
  { productIdx: 2, label: "Shahid #1", email: "sh.demo1@example.com", capacity: 4, startOffset: -20, expiryOffset: 10, status: "active" as const },
  { productIdx: 3, label: "ChatGPT #1", email: "gpt.demo1@example.com", capacity: 1, startOffset: -8, expiryOffset: 22, status: "active" as const },
  { productIdx: 3, label: "ChatGPT #2", email: "gpt.demo2@example.com", capacity: 1, startOffset: -32, expiryOffset: -2, status: "needs_attention" as const, notes: "Expired upstream" },
  { productIdx: 4, label: "Disney #1", email: "dp.demo1@example.com", capacity: 4, startOffset: -12, expiryOffset: 18, status: "active" as const },
  { productIdx: 5, label: "YouTube #1", email: "yt.demo1@example.com", capacity: 5, startOffset: -18, expiryOffset: 12, status: "active" as const },
  { productIdx: 5, label: "YouTube #2", email: "yt.demo2@example.com", capacity: 5, startOffset: -3, expiryOffset: 27, status: "active" as const },
];

const CUSTOMERS = Array.from({ length: 20 }, (_, index) => ({
  name: `Customer ${index + 1}`,
  phone: `07912345${String(index + 1).padStart(2, "0")}`,
  whatsapp: index % 2 === 0 ? `07912345${String(index + 1).padStart(2, "0")}` : null,
  email: index % 3 === 0 ? `customer${index + 1}@example.com` : null,
  notes: index % 5 === 0 ? "Demo note" : null,
}));

const SUBSCRIPTIONS = [
  { accountIdx: 0, slotIndex: 1, customerIdx: 0, startOffset: -27, expiryOffset: 3, status: "active" as const },
  { accountIdx: 0, slotIndex: 2, customerIdx: 1, startOffset: -26, expiryOffset: 4, status: "active" as const },
  { accountIdx: 4, slotIndex: 1, customerIdx: 2, startOffset: -25, expiryOffset: 5, status: "active" as const },
  { accountIdx: 8, slotIndex: 1, customerIdx: 3, startOffset: -24, expiryOffset: 6, status: "active" as const },
  { accountIdx: 2, slotIndex: 1, customerIdx: 4, startOffset: -23, expiryOffset: 7, status: "active" as const },
  { accountIdx: 0, slotIndex: 3, customerIdx: 5, startOffset: -20, expiryOffset: 10, status: "active" as const },
  { accountIdx: 2, slotIndex: 2, customerIdx: 6, startOffset: -18, expiryOffset: 12, status: "active" as const },
  { accountIdx: 4, slotIndex: 2, customerIdx: 7, startOffset: -16, expiryOffset: 14, status: "active" as const },
  { accountIdx: 1, slotIndex: 1, customerIdx: 8, startOffset: -15, expiryOffset: 15, status: "active" as const },
  { accountIdx: 8, slotIndex: 2, customerIdx: 9, startOffset: -12, expiryOffset: 18, status: "active" as const },
  { accountIdx: 1, slotIndex: 2, customerIdx: 10, startOffset: -10, expiryOffset: 20, status: "active" as const },
  { accountIdx: 5, slotIndex: 1, customerIdx: 11, startOffset: -9, expiryOffset: 21, status: "active" as const },
  { accountIdx: 7, slotIndex: 1, customerIdx: 12, startOffset: -6, expiryOffset: 24, status: "active" as const },
  { accountIdx: 3, slotIndex: 1, customerIdx: 13, startOffset: -5, expiryOffset: 25, status: "active" as const },
  { accountIdx: 7, slotIndex: 2, customerIdx: 14, startOffset: -3, expiryOffset: 27, status: "active" as const },
  { accountIdx: 9, slotIndex: 1, customerIdx: 15, startOffset: -1, expiryOffset: 29, status: "active" as const },
  { accountIdx: 3, slotIndex: 2, customerIdx: 16, startOffset: -2, expiryOffset: 40, status: "active" as const },
  { accountIdx: 9, slotIndex: 2, customerIdx: 17, startOffset: -1, expiryOffset: 45, status: "active" as const },
  { accountIdx: 0, slotIndex: 1, customerIdx: 18, startOffset: -90, expiryOffset: -60, status: "expired" as const },
  { accountIdx: 0, slotIndex: 2, customerIdx: 19, startOffset: -85, expiryOffset: -55, status: "expired" as const },
  { accountIdx: 2, slotIndex: 1, customerIdx: 0, startOffset: -75, expiryOffset: -45, status: "expired" as const },
  { accountIdx: 4, slotIndex: 1, customerIdx: 1, startOffset: -70, expiryOffset: -40, status: "expired" as const },
  { accountIdx: 6, slotIndex: 1, customerIdx: 2, startOffset: -65, expiryOffset: -35, status: "expired" as const },
  { accountIdx: 8, slotIndex: 1, customerIdx: 3, startOffset: -60, expiryOffset: -30, status: "expired" as const },
  { accountIdx: 1, slotIndex: 1, customerIdx: 4, startOffset: -50, expiryOffset: -20, status: "expired" as const },
  { accountIdx: 7, slotIndex: 1, customerIdx: 5, startOffset: -40, expiryOffset: -10, status: "expired" as const },
  { accountIdx: 1, slotIndex: 3, customerIdx: 6, startOffset: -30, expiryOffset: 0, status: "cancelled" as const },
  { accountIdx: 8, slotIndex: 3, customerIdx: 7, startOffset: -25, expiryOffset: 5, status: "cancelled" as const },
  { accountIdx: 9, slotIndex: 3, customerIdx: 8, startOffset: -20, expiryOffset: 10, status: "cancelled" as const },
  { accountIdx: 4, slotIndex: 3, customerIdx: 9, startOffset: -15, expiryOffset: 15, status: "cancelled" as const },
] as const;

async function seedDemoData(): Promise<void> {
  await db.insert(settingsTable).values([
    { orgId: DEMO_ORG_ID, key: "business_name", value: "Demo Organization" },
    { orgId: DEMO_ORG_ID, key: "currency", value: "JOD" },
    { orgId: DEMO_ORG_ID, key: "grace_days", value: "3" },
    { orgId: DEMO_ORG_ID, key: "reminder_lead_days", value: "3" },
    { orgId: DEMO_ORG_ID, key: "reminder_recipient", value: "staff" },
  ]);

  const products = await db.insert(productsTable).values(
    PRODUCTS.map((product) => ({ ...product, orgId: DEMO_ORG_ID })),
  ).returning();

  const slotIdByAccountAndIndex = new Map<string, number>();
  for (const [accountIndex, spec] of ACCOUNTS.entries()) {
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

    const slots = await db.insert(slotsTable).values(
      Array.from({ length: spec.capacity }, (_, slotOffset) => ({
        accountId: account.id,
        slotIndex: slotOffset + 1,
        status: "free" as const,
      })),
    ).returning();

    for (const slot of slots) {
      slotIdByAccountAndIndex.set(`${accountIndex}:${slot.slotIndex}`, slot.id);
    }
  }

  const customers = await db.insert(customersTable).values(
    CUSTOMERS.map((customer) => ({ ...customer, orgId: DEMO_ORG_ID })),
  ).returning();

  let paymentCount = 0;
  for (const [index, spec] of SUBSCRIPTIONS.entries()) {
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

    const payments: Array<typeof paymentsTable.$inferInsert> = [
      {
        orgId: DEMO_ORG_ID,
        subscriptionId: subscription.id,
        amount: price,
        method: index % 2 === 0 ? "cash" : "transfer",
        paidAt: isoDateTime(spec.startOffset),
      },
    ];

    if (index % 3 === 0) {
      payments.push({
        orgId: DEMO_ORG_ID,
        subscriptionId: subscription.id,
        amount: price,
        method: "transfer",
        paidAt: isoDateTime(spec.startOffset - 30),
      });
    }

    if (index % 5 === 0) {
      payments.push({
        orgId: DEMO_ORG_ID,
        subscriptionId: subscription.id,
        amount: price,
        method: "cash",
        paidAt: isoDateTime(spec.startOffset - 90),
      });
    }

    await db.insert(paymentsTable).values(payments);
    paymentCount += payments.length;
  }

  logger.info({
    products: products.length,
    accounts: ACCOUNTS.length,
    customers: customers.length,
    subscriptions: SUBSCRIPTIONS.length,
    payments: paymentCount,
  }, "Demo data seeded");
}

export default async function seed(): Promise<void> {
  await ensurePlatformAdmin();
  await ensureDemoOrg();

  if (process.env.NODE_ENV === "production") {
    await wipeDemoOrg();
    await ensureDemoUsers();
    await seedDemoData();
    return;
  }

  await ensureDemoUsers();
  const [existingDemoProduct] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(eq(productsTable.orgId, DEMO_ORG_ID));

  if (existingDemoProduct) {
    logger.info("Demo products already exist - skipping demo data seed");
    return;
  }

  await seedDemoData();
}
