import { Router, type IRouter } from "express";
import {
  accountsTable,
  db,
  paymentsTable,
  productsTable,
  slotsTable,
  subscriptionsTable,
} from "@workspace/db";
import { and, asc, eq, gt, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getSettings } from "../lib/settings";
import { baseSubscriptionQuery, hasNoLaterSubscription } from "../lib/subscription-query";
import { statusCondition } from "../lib/subscription-status";

const router: IRouter = Router();

router.get("/dashboard", requireAuth, async (_req, res): Promise<void> => {
  const settings = await getSettings();
  const futureActive = and(
    eq(subscriptionsTable.status, "active"),
    gte(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now')`),
  );
  const expiringCounts = Object.fromEntries(
    await Promise.all(
      [1, 3, 7].map(async (days) => {
        const result = await db
          .select({ count: sql<number>`count(*)` })
          .from(subscriptionsTable)
          .where(
            and(
              futureActive,
              lte(
                sql`date(${subscriptionsTable.expiryDate})`,
                sql`date('now', ${`+${days} days`})`,
              ),
            ),
          )
          .get();
        return [days, result?.count ?? 0];
      }),
    ),
  );

  const [overdue, freeSlotsByProduct, totals] = await Promise.all([
    baseSubscriptionQuery()
      .where(and(statusCondition("expired"), hasNoLaterSubscription))
      .orderBy(asc(subscriptionsTable.expiryDate)),
    db
      .select({
        productId: productsTable.id,
        productName: productsTable.name,
        freeSlots: sql<number>`count(case when ${slotsTable.status} = 'free' then 1 end)`,
        totalSlots: sql<number>`count(${slotsTable.id})`,
      })
      .from(productsTable)
      .leftJoin(
        accountsTable,
        and(
          eq(accountsTable.productId, productsTable.id),
          eq(accountsTable.status, "active"),
        ),
      )
      .leftJoin(slotsTable, eq(slotsTable.accountId, accountsTable.id))
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.name)),
    Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(subscriptionsTable).where(statusCondition("active")).get(),
      db.select({ count: sql<number>`count(*)` }).from(accountsTable).get(),
      db
        .select({ total: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
        .from(paymentsTable)
        .where(gte(sql`datetime(${paymentsTable.paidAt})`, sql`datetime('now', 'start of month')`))
        .get(),
    ]),
  ]);

  res.json({
    expiringCounts,
    overdue,
    freeSlotsByProduct,
    totals: {
      activeSubscriptions: totals[0]?.count ?? 0,
      totalAccounts: totals[1]?.count ?? 0,
      monthlyRevenue: totals[2]?.total ?? 0,
    },
    settings,
  });
});

export default router;
