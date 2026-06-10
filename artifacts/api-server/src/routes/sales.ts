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
  saleInputSchema,
  validationError,
} from "@workspace/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();

function isActiveSlotConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("subscriptions_one_active_per_slot_idx") ||
      error.message.includes("UNIQUE constraint failed: subscriptions.slot_id"))
  );
}

router.get(
  "/sales/availability",
  requireAuth,
  async (_req, res): Promise<void> => {
    const products = await db
      .select({
        id: productsTable.id,
        name: productsTable.name,
        service: productsTable.service,
        defaultDurationDays: productsTable.defaultDurationDays,
        defaultPrice: productsTable.defaultPrice,
        freeSlotCount: sql<number>`count(${slotsTable.id})`,
      })
      .from(productsTable)
      .innerJoin(
        accountsTable,
        and(
          eq(accountsTable.productId, productsTable.id),
          eq(accountsTable.status, "active"),
        ),
      )
      .innerJoin(
        slotsTable,
        and(
          eq(slotsTable.accountId, accountsTable.id),
          eq(slotsTable.status, "free"),
        ),
      )
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.createdAt));

    const freeSlots = await db
      .select({
        id: slotsTable.id,
        accountId: accountsTable.id,
        accountLabel: accountsTable.label,
        productId: productsTable.id,
        productName: productsTable.name,
        slotIndex: slotsTable.slotIndex,
      })
      .from(slotsTable)
      .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
      .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
      .where(
        and(eq(slotsTable.status, "free"), eq(accountsTable.status, "active")),
      )
      .orderBy(asc(accountsTable.createdAt), asc(slotsTable.slotIndex));

    res.json({ products, freeSlots });
  },
);

router.post("/sales", requireAuth, async (req, res): Promise<void> => {
  const parsed = saleInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const user = getRequestUser(req);
  const input = parsed.data;

  try {
    const result = db.transaction((tx) => {
      const customer = tx
        .select({ id: customersTable.id, name: customersTable.name })
        .from(customersTable)
        .where(eq(customersTable.id, input.customerId))
        .get();
      if (!customer) return { error: "customer_missing" as const };

      const product = tx
        .select({ id: productsTable.id, name: productsTable.name })
        .from(productsTable)
        .where(eq(productsTable.id, input.productId))
        .get();
      if (!product) return { error: "product_missing" as const };

      const slotCondition = input.slotId
        ? and(
            eq(slotsTable.id, input.slotId),
            eq(accountsTable.productId, input.productId),
          )
        : eq(accountsTable.productId, input.productId);

      const slot = tx
        .select({
          id: slotsTable.id,
          slotIndex: slotsTable.slotIndex,
          accountId: accountsTable.id,
          accountLabel: accountsTable.label,
        })
        .from(slotsTable)
        .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
        .where(
          and(
            slotCondition,
            eq(slotsTable.status, "free"),
            eq(accountsTable.status, "active"),
          ),
        )
        .orderBy(asc(accountsTable.createdAt), asc(slotsTable.slotIndex))
        .limit(1)
        .get();
      if (!slot) return { error: "slot_unavailable" as const };

      const occupied = tx
        .update(slotsTable)
        .set({ status: "occupied" })
        .where(and(eq(slotsTable.id, slot.id), eq(slotsTable.status, "free")))
        .returning({ id: slotsTable.id })
        .get();
      if (!occupied) return { error: "slot_unavailable" as const };

      const subscription = tx
        .insert(subscriptionsTable)
        .values({
          slotId: slot.id,
          customerId: customer.id,
          startDate: input.startDate,
          expiryDate: input.expiryDate,
          price: input.price,
          status: "active",
          notes: input.notes,
        })
        .returning()
        .get();

      const payment = tx
        .insert(paymentsTable)
        .values({
          subscriptionId: subscription.id,
          amount: input.payment.amount,
          method: input.payment.method,
          paidAt: input.payment.paidAt,
          loggedBy: user.id,
          notes: input.payment.notes,
        })
        .returning()
        .get();

      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "sale",
          entity: "subscription",
          entityId: subscription.id,
          detail: `بيع ${product.name} للعميل ${customer.name} على الحساب ${slot.accountLabel}، المقعد ${slot.slotIndex}، بقيمة ${input.price}`,
        })
        .run();

      return {
        subscription,
        payment,
        slot: { ...slot, productId: product.id, productName: product.name },
      };
    });

    if ("error" in result) {
      if (result.error === "customer_missing") {
        res.status(404).json({ error: "العميل غير موجود" });
        return;
      }
      if (result.error === "product_missing") {
        res.status(404).json({ error: "المنتج غير موجود" });
        return;
      }
      res.status(409).json({ error: "المقعد غير متاح أو تم بيعه بالفعل" });
      return;
    }

    res.status(201).json(result);
  } catch (error) {
    if (isActiveSlotConflict(error)) {
      res.status(409).json({ error: "المقعد غير متاح أو تم بيعه بالفعل" });
      return;
    }
    throw error;
  }
});

export default router;
