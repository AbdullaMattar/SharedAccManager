import { Router, type IRouter } from "express";
import {
  accountsTable,
  auditLogTable,
  customersTable,
  db,
  paymentsTable,
  productsTable,
  slotsTable,
  subscriptionsTable,
  usersTable,
  idParamsSchema,
  listSubscriptionsQuerySchema,
  subscriptionNotesSchema,
  validationError,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();

const subscriptionSummary = {
  id: subscriptionsTable.id,
  customerId: customersTable.id,
  customerName: customersTable.name,
  slotId: slotsTable.id,
  slotIndex: slotsTable.slotIndex,
  accountId: accountsTable.id,
  accountLabel: accountsTable.label,
  productId: productsTable.id,
  productName: productsTable.name,
  startDate: subscriptionsTable.startDate,
  expiryDate: subscriptionsTable.expiryDate,
  price: subscriptionsTable.price,
  status: subscriptionsTable.status,
  notes: subscriptionsTable.notes,
  createdAt: subscriptionsTable.createdAt,
};

function baseSubscriptionQuery() {
  return db
    .select(subscriptionSummary)
    .from(subscriptionsTable)
    .innerJoin(
      customersTable,
      eq(subscriptionsTable.customerId, customersTable.id),
    )
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id));
}

router.get("/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const parsed = listSubscriptionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const conditions = [];
  if (parsed.data.status)
    conditions.push(eq(subscriptionsTable.status, parsed.data.status));
  if (parsed.data.customerId)
    conditions.push(eq(subscriptionsTable.customerId, parsed.data.customerId));

  const subscriptions = await baseSubscriptionQuery()
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(subscriptionsTable.createdAt));
  res.json(subscriptions);
});

router.get(
  "/subscriptions/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: validationError(params.error) });
      return;
    }

    const subscription = await baseSubscriptionQuery()
      .where(eq(subscriptionsTable.id, params.data.id))
      .get();
    if (!subscription) {
      res.status(404).json({ error: "الاشتراك غير موجود" });
      return;
    }

    const [payments, history] = await Promise.all([
      db
        .select({
          id: paymentsTable.id,
          subscriptionId: paymentsTable.subscriptionId,
          amount: paymentsTable.amount,
          method: paymentsTable.method,
          paidAt: paymentsTable.paidAt,
          loggedBy: paymentsTable.loggedBy,
          loggedByName: usersTable.name,
          notes: paymentsTable.notes,
        })
        .from(paymentsTable)
        .leftJoin(usersTable, eq(paymentsTable.loggedBy, usersTable.id))
        .where(eq(paymentsTable.subscriptionId, subscription.id))
        .orderBy(desc(paymentsTable.paidAt)),
      baseSubscriptionQuery()
        .where(eq(subscriptionsTable.slotId, subscription.slotId))
        .orderBy(
          desc(subscriptionsTable.startDate),
          desc(subscriptionsTable.createdAt),
        ),
    ]);

    res.json({ ...subscription, payments, slotHistory: history });
  },
);

router.patch(
  "/subscriptions/:id/notes",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = idParamsSchema.safeParse(req.params);
    const parsed = subscriptionNotesSchema.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: validationError(params.error) });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: validationError(parsed.error) });
      return;
    }

    const user = getRequestUser(req);
    const subscription = db.transaction((tx) => {
      const updated = tx
        .update(subscriptionsTable)
        .set({ notes: parsed.data.notes })
        .where(eq(subscriptionsTable.id, params.data.id))
        .returning()
        .get();
      if (!updated) return null;
      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "subscription_notes_update",
          entity: "subscription",
          entityId: updated.id,
          detail: "تحديث ملاحظات الاشتراك",
        })
        .run();
      return updated;
    });

    if (!subscription) {
      res.status(404).json({ error: "الاشتراك غير موجود" });
      return;
    }
    res.json(subscription);
  },
);

router.post(
  "/subscriptions/:id/cancel",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: validationError(params.error) });
      return;
    }

    const user = getRequestUser(req);
    const result = db.transaction((tx) => {
      const subscription = tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, params.data.id))
        .get();
      if (!subscription) return { error: "missing" as const };
      if (subscription.status !== "active")
        return { error: "not_active" as const };

      const cancelled = tx
        .update(subscriptionsTable)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(subscriptionsTable.id, subscription.id),
            eq(subscriptionsTable.status, "active"),
          ),
        )
        .returning()
        .get();
      if (!cancelled) return { error: "not_active" as const };

      tx.update(slotsTable)
        .set({ status: "free" })
        .where(
          and(
            eq(slotsTable.id, subscription.slotId),
            eq(slotsTable.status, "occupied"),
          ),
        )
        .run();
      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "subscription_cancel",
          entity: "subscription",
          entityId: subscription.id,
          detail: `إلغاء الاشتراك وتحرير المقعد ${subscription.slotId}`,
        })
        .run();

      return { subscription: cancelled };
    });

    if ("error" in result) {
      if (result.error === "missing") {
        res.status(404).json({ error: "الاشتراك غير موجود" });
        return;
      }
      res.status(409).json({ error: "لا يمكن إلغاء اشتراك غير نشط" });
      return;
    }
    res.json(result.subscription);
  },
);

export default router;
