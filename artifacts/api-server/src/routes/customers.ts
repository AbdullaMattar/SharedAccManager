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
  customerInputSchema,
  customerUpdateSchema,
  idParamsSchema,
  listCustomersQuerySchema,
  validationError,
} from "@workspace/db";
import { asc, desc, eq, like, or, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();

function isUniquePhoneError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: customers.phone")
  );
}

async function customerSubscriptions(customerId: number) {
  return db
    .select({
      id: subscriptionsTable.id,
      customerId: customersTable.id,
      customerName: customersTable.name,
      slotId: subscriptionsTable.slotId,
      productId: productsTable.id,
      productName: productsTable.name,
      accountId: accountsTable.id,
      accountLabel: accountsTable.label,
      slotIndex: slotsTable.slotIndex,
      startDate: subscriptionsTable.startDate,
      expiryDate: subscriptionsTable.expiryDate,
      price: subscriptionsTable.price,
      status: subscriptionsTable.status,
      notes: subscriptionsTable.notes,
      createdAt: subscriptionsTable.createdAt,
    })
    .from(subscriptionsTable)
    .innerJoin(
      customersTable,
      eq(subscriptionsTable.customerId, customersTable.id),
    )
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(eq(subscriptionsTable.customerId, customerId))
    .orderBy(desc(subscriptionsTable.createdAt));
}

router.get("/customers", requireAuth, async (req, res): Promise<void> => {
  const parsed = listCustomersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const search = parsed.data.q ? `%${parsed.data.q}%` : undefined;
  const customers = await db
    .select()
    .from(customersTable)
    .where(
      search
        ? or(
            like(customersTable.name, search),
            like(customersTable.phone, search),
          )
        : undefined,
    )
    .orderBy(asc(customersTable.name));
  res.json(customers);
});

router.post("/customers", requireAuth, async (req, res): Promise<void> => {
  const parsed = customerInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  try {
    const user = getRequestUser(req);
    const customer = db.transaction((tx) => {
      const [created] = tx
        .insert(customersTable)
        .values({
          ...parsed.data,
          whatsapp: parsed.data.whatsapp || parsed.data.phone,
        })
        .returning()
        .all();
      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "customer_create",
          entity: "customer",
          entityId: created.id,
          detail: `إنشاء العميل: ${created.name} (${created.phone})`,
        })
        .run();
      return created;
    });
    res.status(201).json(customer);
  } catch (error) {
    if (isUniquePhoneError(error)) {
      res.status(409).json({ error: "رقم الهاتف مستخدم لعميل آخر" });
      return;
    }
    throw error;
  }
});

router.get("/customers/:id", requireAuth, async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }

  const customer = await db
    .select()
    .from(customersTable)
    .where(eq(customersTable.id, params.data.id))
    .get();
  if (!customer) {
    res.status(404).json({ error: "العميل غير موجود" });
    return;
  }

  const [subscriptions, total] = await Promise.all([
    customerSubscriptions(customer.id),
    db
      .select({
        totalSpent: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
      })
      .from(paymentsTable)
      .innerJoin(
        subscriptionsTable,
        eq(paymentsTable.subscriptionId, subscriptionsTable.id),
      )
      .where(eq(subscriptionsTable.customerId, customer.id))
      .get(),
  ]);

  res.json({ ...customer, totalSpent: total?.totalSpent ?? 0, subscriptions });
});

router.patch("/customers/:id", requireAuth, async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  const parsed = customerUpdateSchema.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  try {
    const user = getRequestUser(req);
    const customer = db.transaction((tx) => {
      const [updated] = tx
        .update(customersTable)
        .set(parsed.data)
        .where(eq(customersTable.id, params.data.id))
        .returning()
        .all();
      if (!updated) return null;
      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "customer_update",
          entity: "customer",
          entityId: updated.id,
          detail: `تحديث بيانات العميل: ${updated.name}`,
        })
        .run();
      return updated;
    });
    if (!customer) {
      res.status(404).json({ error: "العميل غير موجود" });
      return;
    }
    res.json(customer);
  } catch (error) {
    if (isUniquePhoneError(error)) {
      res.status(409).json({ error: "رقم الهاتف مستخدم لعميل آخر" });
      return;
    }
    throw error;
  }
});

router.delete(
  "/customers/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: validationError(params.error) });
      return;
    }

    const user = getRequestUser(req);
    const result = db.transaction((tx) => {
      const linked = tx
        .select({ id: subscriptionsTable.id })
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.customerId, params.data.id))
        .limit(1)
        .get();
      if (linked) return "linked" as const;

      const deleted = tx
        .delete(customersTable)
        .where(eq(customersTable.id, params.data.id))
        .returning()
        .get();
      if (!deleted) return "missing" as const;
      tx.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "customer_delete",
          entity: "customer",
          entityId: deleted.id,
          detail: `حذف العميل: ${deleted.name} (${deleted.phone})`,
        })
        .run();
      return "deleted" as const;
    });

    if (result === "linked") {
      res.status(409).json({ error: "لا يمكن حذف عميل لديه اشتراكات" });
      return;
    }
    if (result === "missing") {
      res.status(404).json({ error: "العميل غير موجود" });
      return;
    }
    res.sendStatus(204);
  },
);

export default router;
