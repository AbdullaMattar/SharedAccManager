import { db, usersTable, productsTable, accountsTable, slotsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { encrypt } from "./lib/crypto";
import { logger } from "./lib/logger";

function dateAfter(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seed() {
  // Create admin user
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@example.com";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "admin123";

  const [existingAdmin] = await db.select().from(usersTable).where(eq(usersTable.email, adminEmail));

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await db.insert(usersTable).values({
      name: "مدير النظام",
      email: adminEmail,
      passwordHash,
      role: "admin",
    });
    logger.info({ email: adminEmail }, "Admin user created");
    logger.info("Admin password loaded from configuration; change it after first login");
  } else {
    logger.info("Admin user already exists — skipping");
  }

  // Seed sample products
  const existingProducts = await db.select().from(productsTable);
  if (existingProducts.length === 0) {
    const products = await db
      .insert(productsTable)
      .values([
        {
          name: "نتفليكس بريميوم — مشترك",
          service: "Netflix",
          defaultCapacity: 5,
          defaultDurationDays: 30,
          defaultPrice: 15,
          notes: "حساب مشترك 5 مقاعد",
        },
        {
          name: "سبوتيفاي — مشترك",
          service: "Spotify",
          defaultCapacity: 6,
          defaultDurationDays: 30,
          defaultPrice: 8,
          notes: "حساب عائلي 6 مقاعد",
        },
        {
          name: "شات جي بي تي بلس — كامل",
          service: "ChatGPT",
          defaultCapacity: 1,
          defaultDurationDays: 30,
          defaultPrice: 25,
          notes: "حساب كامل",
        },
      ])
      .returning();

    logger.info({ count: products.length }, "Sample products created");

    // Create one sample account for Netflix
    const netflixProduct = products[0];
    if (netflixProduct) {
      const [account] = await db
        .insert(accountsTable)
        .values({
          productId: netflixProduct.id,
          label: "نتفليكس #1",
          email: "netflix.account@example.com",
          passwordEncrypted: encrypt("SamplePass123!"),
          capacity: netflixProduct.defaultCapacity,
          status: "active",
          startDate: new Date().toISOString().slice(0, 10),
          expiryDate: dateAfter(netflixProduct.defaultDurationDays),
          notes: "حساب تجريبي",
        })
        .returning();

      // Auto-create slots
      const slotValues = Array.from({ length: account.capacity }, (_, i) => ({
        accountId: account.id,
        slotIndex: i + 1,
        status: "free" as const,
      }));
      await db.insert(slotsTable).values(slotValues);
      logger.info({ accountId: account.id, slots: account.capacity }, "Sample account with slots created");
    }
  } else {
    logger.info("Products already exist — skipping seed");
  }
}

export default seed;
