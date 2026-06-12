import {
  db,
  usersTable,
  productsTable,
  accountsTable,
  slotsTable,
  customersTable,
  subscriptionsTable,
  paymentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { encrypt } from "./lib/crypto";
import { logger } from "./lib/logger";

/** ISO date (YYYY-MM-DD) offset by N days from today. */
function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** ISO datetime (YYYY-MM-DD HH:MM:SS) offset by N days from now. */
function isoDateTime(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function ensureUser(
  name: string,
  email: string,
  password: string,
  role: "admin" | "staff",
): Promise<boolean> {
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) return false;
  await db.insert(usersTable).values({
    name,
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role,
  });
  return true;
}

// ── Demo data specs ───────────────────────────────────────────────────────────

const PRODUCTS = [
  { name: "نتفليكس بريميوم — مشترك", service: "Netflix", defaultCapacity: 5, defaultDurationDays: 30, defaultPrice: 15, notes: "حساب مشترك 5 مقاعد" },
  { name: "سبوتيفاي عائلي — مشترك", service: "Spotify", defaultCapacity: 6, defaultDurationDays: 30, defaultPrice: 8, notes: "حساب عائلي 6 مقاعد" },
  { name: "شاهد VIP — مشترك", service: "Shahid", defaultCapacity: 4, defaultDurationDays: 30, defaultPrice: 10, notes: "باقة VIP رياضة وترفيه" },
  { name: "شات جي بي تي بلس — كامل", service: "ChatGPT", defaultCapacity: 1, defaultDurationDays: 30, defaultPrice: 25, notes: "حساب كامل غير مشترك" },
  { name: "ديزني بلس — مشترك", service: "Disney+", defaultCapacity: 4, defaultDurationDays: 30, defaultPrice: 12, notes: "حساب مشترك 4 مقاعد" },
  { name: "يوتيوب بريميوم عائلي", service: "YouTube", defaultCapacity: 5, defaultDurationDays: 30, defaultPrice: 7, notes: "باقة عائلية" },
];

// productIdx refers to PRODUCTS order. start/expiry are day-offsets from today.
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

// accountIdx → ACCOUNTS order; slotIndex is 1-based within the account;
// customerIdx → CUSTOMERS order. Offsets are days from today.
// The partial unique index allows only ONE active subscription per slot —
// expired/cancelled rows may share a slot with an active one.
const SUBSCRIPTIONS: {
  accountIdx: number; slotIndex: number; customerIdx: number;
  startOffset: number; expiryOffset: number;
  status: "active" | "expired" | "cancelled";
}[] = [
  // Active — 5 expiring within 7 days (populates the "expiring soon" page)
  { accountIdx: 0, slotIndex: 1, customerIdx: 0, startOffset: -27, expiryOffset: 3, status: "active" },
  { accountIdx: 0, slotIndex: 2, customerIdx: 1, startOffset: -26, expiryOffset: 4, status: "active" },
  { accountIdx: 4, slotIndex: 1, customerIdx: 2, startOffset: -25, expiryOffset: 5, status: "active" },
  { accountIdx: 8, slotIndex: 1, customerIdx: 3, startOffset: -24, expiryOffset: 6, status: "active" },
  { accountIdx: 2, slotIndex: 1, customerIdx: 4, startOffset: -23, expiryOffset: 7, status: "active" },
  // Active — later expiries
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
  // Expired — past months (history for the revenue charts)
  { accountIdx: 0, slotIndex: 1, customerIdx: 18, startOffset: -90, expiryOffset: -60, status: "expired" },
  { accountIdx: 0, slotIndex: 2, customerIdx: 19, startOffset: -85, expiryOffset: -55, status: "expired" },
  { accountIdx: 2, slotIndex: 1, customerIdx: 0, startOffset: -75, expiryOffset: -45, status: "expired" },
  { accountIdx: 4, slotIndex: 1, customerIdx: 1, startOffset: -70, expiryOffset: -40, status: "expired" },
  { accountIdx: 6, slotIndex: 1, customerIdx: 2, startOffset: -65, expiryOffset: -35, status: "expired" },
  { accountIdx: 8, slotIndex: 1, customerIdx: 3, startOffset: -60, expiryOffset: -30, status: "expired" },
  { accountIdx: 1, slotIndex: 1, customerIdx: 4, startOffset: -50, expiryOffset: -20, status: "expired" },
  { accountIdx: 7, slotIndex: 1, customerIdx: 5, startOffset: -40, expiryOffset: -10, status: "expired" },
  // Cancelled
  { accountIdx: 1, slotIndex: 3, customerIdx: 6, startOffset: -30, expiryOffset: 0, status: "cancelled" },
  { accountIdx: 8, slotIndex: 3, customerIdx: 7, startOffset: -25, expiryOffset: 5, status: "cancelled" },
  { accountIdx: 9, slotIndex: 3, customerIdx: 8, startOffset: -20, expiryOffset: 10, status: "cancelled" },
  { accountIdx: 4, slotIndex: 3, customerIdx: 9, startOffset: -15, expiryOffset: 15, status: "cancelled" },
];

// ── Seed ──────────────────────────────────────────────────────────────────────

async function seed() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";

  if (await ensureUser("مدير النظام", adminEmail, adminPassword, "admin")) {
    logger.info({ email: adminEmail }, "Admin user created");
  } else {
    logger.info("Admin user already exists — skipping");
  }

  if (await ensureUser("موظف تجريبي", "staff@example.com", "staff123", "staff")) {
    logger.info("Staff demo user created");
  }

  const existingProducts = await db.select().from(productsTable);
  if (existingProducts.length > 0) {
    logger.info("Products already exist — skipping demo data seed");
    return;
  }

  // Products
  const products = await db.insert(productsTable).values(PRODUCTS).returning();

  // Accounts + slots
  const accountIds: number[] = [];
  const slotIdByAccountAndIndex = new Map<string, number>();
  for (const spec of ACCOUNTS) {
    const product = products[spec.productIdx]!;
    const [account] = await db
      .insert(accountsTable)
      .values({
        productId: product.id,
        label: spec.label,
        email: spec.email,
        passwordEncrypted: encrypt("DemoPass123!"),
        capacity: spec.capacity,
        status: spec.status,
        startDate: isoDate(spec.startOffset),
        expiryDate: isoDate(spec.expiryOffset),
        notes: spec.notes,
      })
      .returning();
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

  // Customers
  const customers = await db.insert(customersTable).values(CUSTOMERS).returning();

  // Subscriptions + payments
  let paymentCount = 0;
  for (const [i, spec] of SUBSCRIPTIONS.entries()) {
    const slotId = slotIdByAccountAndIndex.get(`${spec.accountIdx}:${spec.slotIndex}`)!;
    const customer = customers[spec.customerIdx]!;
    const product = products[ACCOUNTS[spec.accountIdx]!.productIdx]!;
    const price = product.defaultPrice;

    const [subscription] = await db
      .insert(subscriptionsTable)
      .values({
        slotId,
        customerId: customer.id,
        startDate: isoDate(spec.startOffset),
        expiryDate: isoDate(spec.expiryOffset),
        price,
        status: spec.status,
      })
      .returning();

    if (spec.status === "active") {
      await db.update(slotsTable).set({ status: "occupied" }).where(eq(slotsTable.id, slotId));
    }

    // Payment at subscription start; alternate cash/transfer.
    const payments = [
      {
        subscriptionId: subscription!.id,
        amount: price,
        method: (i % 2 === 0 ? "cash" : "transfer") as "cash" | "transfer",
        paidAt: isoDateTime(spec.startOffset),
      },
    ];
    // Renewal history for some customers — fills the 6-month revenue chart.
    if (i % 3 === 0) {
      payments.push({
        subscriptionId: subscription!.id,
        amount: price,
        method: "transfer" as const,
        paidAt: isoDateTime(spec.startOffset - 30),
      });
    }
    if (i % 5 === 0) {
      payments.push({
        subscriptionId: subscription!.id,
        amount: price,
        method: "cash" as const,
        paidAt: isoDateTime(spec.startOffset - 90),
      });
    }
    await db.insert(paymentsTable).values(payments);
    paymentCount += payments.length;
  }

  logger.info(
    {
      products: products.length,
      accounts: ACCOUNTS.length,
      customers: customers.length,
      subscriptions: SUBSCRIPTIONS.length,
      payments: paymentCount,
    },
    "Demo data seeded",
  );
}

export default seed;
