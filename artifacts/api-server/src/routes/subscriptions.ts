import { Router, type IRouter } from "express";
import {
  auditLogTable,
  accountsTable,
  db,
  paymentsTable,
  slotsTable,
  subscriptionsTable,
  usersTable,
  idParamsSchema,
  listSubscriptionsQuerySchema,
  cancelSubscriptionInputSchema,
  subscriptionNotesSchema,
  renewalInputSchema,
  validationError,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getRequestUser } from "../lib/request-user";
import { baseSubscriptionQuery } from "../lib/subscription-query";
import { effectiveStatus, statusCondition } from "../lib/subscription-status";

const router: IRouter = Router();

router.get("/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const parsed = listSubscriptionsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const conditions = [];
  if (parsed.data.status)
    conditions.push(statusCondition(parsed.data.status));
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
    const parsed = cancelSubscriptionInputSchema.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: validationError(params.error) });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: validationError(parsed.error) });
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
      if (effectiveStatus(subscription) !== "active")
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

      let refundAmount = 0;
      if (parsed.data.refunded) {
        const paymentTotal = tx
          .select({
            total: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
          })
          .from(paymentsTable)
          .where(eq(paymentsTable.subscriptionId, subscription.id))
          .get();
        refundAmount = Math.max(paymentTotal?.total ?? 0, 0);
        if (refundAmount > 0) {
          tx.insert(paymentsTable)
            .values({
              subscriptionId: subscription.id,
              amount: -refundAmount,
              method: "other",
              paidAt: new Date().toISOString(),
              loggedBy: user.id,
              notes: "استرداد كامل عند إلغاء الاشتراك",
            })
            .run();
        }
      }

      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "subscription_cancel",
          entity: "subscription",
          entityId: subscription.id,
          detail: parsed.data.refunded
            ? `إلغاء الاشتراك وتحرير الخانة ${subscription.slotId} مع استرداد ${refundAmount}`
            : `إلغاء الاشتراك وتحرير الخانة ${subscription.slotId} بدون استرداد`,
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

router.post(
  "/subscriptions/:id/refund",
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
      if (subscription.status !== "cancelled")
        return { error: "not_cancelled" as const };

      const paymentTotal = tx
        .select({
          total: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
        })
        .from(paymentsTable)
        .where(eq(paymentsTable.subscriptionId, subscription.id))
        .get();
      const refundAmount = Math.max(paymentTotal?.total ?? 0, 0);
      if (refundAmount <= 0) return { error: "already_refunded" as const };

      const refund = tx
        .insert(paymentsTable)
        .values({
          subscriptionId: subscription.id,
          amount: -refundAmount,
          method: "other",
          paidAt: new Date().toISOString(),
          loggedBy: user.id,
          notes: "استرداد كامل بعد إلغاء الاشتراك",
        })
        .returning()
        .get();
      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "subscription_refund",
          entity: "subscription",
          entityId: subscription.id,
          detail: `تسجيل استرداد ${refundAmount} لاشتراك ملغي`,
        })
        .run();

      return { refund };
    });

    if ("error" in result) {
      if (result.error === "missing") {
        res.status(404).json({ error: "الاشتراك غير موجود" });
        return;
      }
      res.status(409).json({
        error:
          result.error === "not_cancelled"
            ? "يمكن تسجيل الاسترداد للاشتراكات الملغية فقط"
            : "تم استرداد مبلغ هذا الاشتراك بالكامل مسبقاً",
      });
      return;
    }
    res.status(201).json(result.refund);
  },
);

router.post(
  "/subscriptions/:id/renew",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = idParamsSchema.safeParse(req.params);
    const parsed = renewalInputSchema.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "بيانات التجديد غير صالحة" });
      return;
    }
    const user = getRequestUser(req);
    const result = db.transaction((tx) => {
      const old = tx.select().from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, params.data.id)).get();
      if (!old) return { error: "missing" as const };
      if (old.status === "cancelled") return { error: "cancelled" as const };
      const account = tx
        .select({
          id: accountsTable.id,
          startDate: accountsTable.startDate,
          expiryDate: accountsTable.expiryDate,
        })
        .from(slotsTable)
        .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
        .where(eq(slotsTable.id, old.slotId))
        .get();
      if (!account) return { error: "missing" as const };
      const newer = tx.select({ id: subscriptionsTable.id }).from(subscriptionsTable)
        .where(and(eq(subscriptionsTable.slotId, old.slotId), eq(subscriptionsTable.status, "active")))
        .get();
      if (newer && newer.id !== old.id) return { error: "already_renewed" as const };

      const today = new Date().toISOString().slice(0, 10);
      const startDate = account.expiryDate > today ? account.expiryDate : today;
      const expiry = new Date(`${startDate}T00:00:00.000Z`);
      expiry.setUTCDate(expiry.getUTCDate() + parsed.data.durationDays);
      const expiryDate = expiry.toISOString().slice(0, 10);

      tx.update(accountsTable)
        .set({ startDate, expiryDate })
        .where(eq(accountsTable.id, account.id))
        .run();

      const accountSlots = tx
        .select({ id: slotsTable.id })
        .from(slotsTable)
        .where(eq(slotsTable.accountId, account.id))
        .all();
      tx.update(subscriptionsTable)
        .set({ startDate, expiryDate })
        .where(and(
          inArray(subscriptionsTable.slotId, accountSlots.map((slot) => slot.id)),
          eq(subscriptionsTable.status, "active"),
        ))
        .run();

      tx.update(subscriptionsTable).set({ status: "expired" })
        .where(eq(subscriptionsTable.id, old.id)).run();
      const subscription = tx.insert(subscriptionsTable).values({
        slotId: old.slotId,
        customerId: old.customerId,
        startDate,
        expiryDate,
        price: parsed.data.price,
        status: "active",
        notes: parsed.data.notes ?? old.notes,
      }).returning().get();
      const payment = tx.insert(paymentsTable).values({
        subscriptionId: subscription.id,
        amount: parsed.data.price,
        method: parsed.data.paymentMethod,
        paidAt: parsed.data.paidAt,
        loggedBy: user.id,
        notes: parsed.data.notes,
      }).returning().get();
      tx.update(slotsTable).set({ status: "occupied" }).where(eq(slotsTable.id, old.slotId)).run();
      tx.insert(auditLogTable).values({
        userId: user.id,
        action: "renew",
        entity: "subscription",
        entityId: subscription.id,
        detail: `تجديد الاشتراك ${old.id} باشتراك جديد ${subscription.id}`,
      }).run();
      return { subscription, payment, previousSubscriptionId: old.id };
    });
    if ("error" in result) {
      const missing = result.error === "missing";
      res.status(missing ? 404 : 409).json({
        error: missing ? "الاشتراك غير موجود" : "لا يمكن تجديد هذا الاشتراك أو تم تجديده بالفعل",
      });
      return;
    }
    res.status(201).json(result);
  },
);

export default router;
