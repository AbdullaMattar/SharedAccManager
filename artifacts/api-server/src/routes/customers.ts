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
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import { computedSubscriptionStatus } from "../lib/subscription-status";

const router: IRouter = Router();

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}

function isUniquePhoneError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed: customers.org_id, customers.phone")
  );
}

async function customerSubscriptions(customerId: number, orgId: number) {
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
      startDate: accountsTable.startDate,
      expiryDate: accountsTable.expiryDate,
      price: subscriptionsTable.price,
      status: computedSubscriptionStatus,
      notes: subscriptionsTable.notes,
      createdAt: subscriptionsTable.createdAt,
    })
    .from(subscriptionsTable)
    .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(and(
      eq(subscriptionsTable.customerId, customerId),
      eq(subscriptionsTable.orgId, orgId),
    ))
    .orderBy(desc(subscriptionsTable.createdAt));
}

router.use("/customers", requireAuth, requireOrgUser);

router.get("/customers", async (req, res): Promise<void> => {
  const parsed = listCustomersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const orgId = getRequestUser(req).orgId!;
  const search = parsed.data.q ? `%${escapeLike(parsed.data.q)}%` : undefined;
  const customers = await db
    .select()
    .from(customersTable)
    .where(and(
      eq(customersTable.orgId, orgId),
      search
        ? sql`(${customersTable.name} LIKE ${search} ESCAPE '\\' OR ${customersTable.phone} LIKE ${search} ESCAPE '\\')`
        : undefined,
    ))
    .orderBy(asc(customersTable.name));
  res.json(customers);
});

router.post("/customers", async (req, res): Promise<void> => {
  const parsed = customerInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  try {
    const user = getRequestUser(req);
    const customer = db.transaction((tx) => {
      const created = tx
        .insert(customersTable)
        .values({
          ...parsed.data,
          orgId: user.orgId!,
          whatsapp: parsed.data.whatsapp || parsed.data.phone,
        })
        .returning()
        .get();
      tx.insert(auditLogTable).values({
        userId: user.id,
        orgId: user.orgId!,
        action: "customer_create",
        entity: "customer",
        entityId: created.id,
        detail: `إنشاء العميل: ${created.name} (${created.phone})`,
      }).run();
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

router.get("/customers/:id", async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }

  const orgId = getRequestUser(req).orgId!;
  const customer = await db
    .select()
    .from(customersTable)
    .where(and(eq(customersTable.id, params.data.id), eq(customersTable.orgId, orgId)))
    .get();
  if (!customer) {
    res.status(404).json({ error: "العميل غير موجود" });
    return;
  }

  const [subscriptions, total] = await Promise.all([
    customerSubscriptions(customer.id, orgId),
    db
      .select({ totalSpent: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
      .from(paymentsTable)
      .innerJoin(subscriptionsTable, eq(paymentsTable.subscriptionId, subscriptionsTable.id))
      .where(and(
        eq(paymentsTable.orgId, orgId),
        eq(subscriptionsTable.customerId, customer.id),
        eq(subscriptionsTable.orgId, orgId),
      ))
      .get(),
  ]);

  res.json({ ...customer, totalSpent: total?.totalSpent ?? 0, subscriptions });
});

router.patch("/customers/:id", async (req, res): Promise<void> => {
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
      const updated = tx
        .update(customersTable)
        .set(parsed.data)
        .where(and(eq(customersTable.id, params.data.id), eq(customersTable.orgId, user.orgId!)))
        .returning()
        .get();
      if (!updated) return null;
      tx.insert(auditLogTable).values({
        userId: user.id,
        orgId: user.orgId!,
        action: "customer_update",
        entity: "customer",
        entityId: updated.id,
        detail: `تحديث بيانات العميل: ${updated.name}`,
      }).run();
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

router.delete("/customers/:id", async (req, res): Promise<void> => {
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
      .where(and(
        eq(subscriptionsTable.customerId, params.data.id),
        eq(subscriptionsTable.orgId, user.orgId!),
      ))
      .limit(1)
      .get();
    if (linked) return "linked" as const;

    const deleted = tx
      .delete(customersTable)
      .where(and(eq(customersTable.id, params.data.id), eq(customersTable.orgId, user.orgId!)))
      .returning()
      .get();
    if (!deleted) return "missing" as const;
    tx.insert(auditLogTable).values({
      userId: user.id,
      orgId: user.orgId!,
      action: "customer_delete",
      entity: "customer",
      entityId: deleted.id,
      detail: `حذف العميل: ${deleted.name} (${deleted.phone})`,
    }).run();
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
});

export default router;
