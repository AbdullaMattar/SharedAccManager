import { Router, type IRouter } from "express";
import { accountsTable, db, paymentsTable, productsTable, slotsTable, subscriptionsTable } from "@workspace/db";
import { asc, eq, gte, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getSettings } from "../lib/settings";

const router: IRouter = Router();

router.get("/reports/revenue", requireAuth, async (_req, res): Promise<void> => {
  const monthCondition = gte(sql`datetime(${paymentsTable.paidAt})`, sql`datetime('now', 'start of month')`);
  const [total, byProduct, settings] = await Promise.all([
    db.select({ revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
      .from(paymentsTable).where(monthCondition).get(),
    db.select({
      productId: productsTable.id,
      productName: productsTable.name,
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
      paymentsCount: sql<number>`count(${paymentsTable.id})`,
    })
      .from(paymentsTable)
      .innerJoin(subscriptionsTable, eq(paymentsTable.subscriptionId, subscriptionsTable.id))
      .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
      .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
      .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
      .where(monthCondition)
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.name)),
    getSettings(),
  ]);
  res.json({ month: new Date().toISOString().slice(0, 7), revenue: total?.revenue ?? 0, byProduct, currency: settings.currency });
});

export default router;
