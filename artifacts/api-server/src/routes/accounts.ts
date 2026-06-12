import { Router, type IRouter } from "express";
import { db, accountsTable, productsTable, slotsTable, subscriptionsTable, auditLogTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import { encrypt, decrypt } from "../lib/crypto";
import {
  CreateAccountBody,
  DeleteAccountParams,
  GetAccountParams,
  ListAccountsQueryParams,
  RevealAccountPasswordParams,
  UpdateAccountBody,
  UpdateAccountParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function toDateText(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

async function buildAccountWithSlots(accountId: number, orgId: number) {
  const [account] = await db
    .select({
      id: accountsTable.id,
      productId: accountsTable.productId,
      productName: productsTable.name,
      label: accountsTable.label,
      email: accountsTable.email,
      capacity: accountsTable.capacity,
      status: accountsTable.status,
      startDate: accountsTable.startDate,
      expiryDate: accountsTable.expiryDate,
      notes: accountsTable.notes,
      createdAt: accountsTable.createdAt,
    })
    .from(accountsTable)
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(and(eq(accountsTable.id, accountId), eq(accountsTable.orgId, orgId)));

  if (!account) return null;

  const slots = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.accountId, accountId))
    .orderBy(slotsTable.slotIndex);
  const freeSlots = slots.filter((slot) => slot.status === "free").length;
  const occupiedSlots = slots.filter((slot) => slot.status === "occupied").length;

  return { ...account, slots, freeSlots, occupiedSlots };
}

router.use("/accounts", requireAuth, requireOrgUser);

router.get("/accounts", async (req, res): Promise<void> => {
  const queryParsed = ListAccountsQueryParams.safeParse(req.query);
  const filters = queryParsed.success ? queryParsed.data : {};
  const orgId = getRequestUser(req).orgId!;

  const conditions = [eq(accountsTable.orgId, orgId)];
  if (filters.productId != null) conditions.push(eq(accountsTable.productId, filters.productId));
  if (filters.status) conditions.push(eq(accountsTable.status, filters.status as "active" | "disabled" | "needs_attention"));

  const accounts = await db
    .select({
      id: accountsTable.id,
      productId: accountsTable.productId,
      productName: productsTable.name,
      label: accountsTable.label,
      email: accountsTable.email,
      capacity: accountsTable.capacity,
      status: accountsTable.status,
      startDate: accountsTable.startDate,
      expiryDate: accountsTable.expiryDate,
      notes: accountsTable.notes,
      createdAt: accountsTable.createdAt,
    })
    .from(accountsTable)
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(and(...conditions))
    .orderBy(accountsTable.createdAt);

  const accountIds = accounts.map((account) => account.id);
  const allSlots = accountIds.length
    ? await db.select().from(slotsTable).where(inArray(slotsTable.accountId, accountIds)).orderBy(slotsTable.accountId, slotsTable.slotIndex)
    : [];

  const slotsByAccount = new Map<number, (typeof slotsTable.$inferSelect)[]>();
  for (const slot of allSlots) {
    const group = slotsByAccount.get(slot.accountId) ?? [];
    group.push(slot);
    slotsByAccount.set(slot.accountId, group);
  }

  res.json(accounts.map((account) => {
    const slots = slotsByAccount.get(account.id) ?? [];
    return {
      ...account,
      slots,
      freeSlots: slots.filter((slot) => slot.status === "free").length,
      occupiedSlots: slots.filter((slot) => slot.status === "occupied").length,
    };
  }));
});

router.post("/accounts", async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const user = getRequestUser(req);
  const orgId = user.orgId!;
  const { password, startDate, expiryDate, ...rest } = parsed.data;
  const accountStartDate = toDateText(startDate);
  const accountExpiryDate = toDateText(expiryDate);
  if (accountExpiryDate < accountStartDate) {
    res.status(400).json({ error: "تاريخ انتهاء الحساب يجب أن يكون بعد تاريخ البداية" });
    return;
  }

  const [product] = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, rest.productId), eq(productsTable.orgId, orgId)));
  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }

  const [account] = await db.insert(accountsTable).values({
    ...rest,
    orgId,
    startDate: accountStartDate,
    expiryDate: accountExpiryDate,
    passwordEncrypted: encrypt(password),
  }).returning();

  await db.insert(slotsTable).values(
    Array.from({ length: account.capacity }, (_, index) => ({
      accountId: account.id,
      slotIndex: index + 1,
      status: "free" as const,
    })),
  );

  res.status(201).json(await buildAccountWithSlots(account.id, orgId));
});

router.get("/accounts/:id", async (req, res): Promise<void> => {
  const params = GetAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const orgId = getRequestUser(req).orgId!;
  const result = await buildAccountWithSlots(params.data.id, orgId);
  if (!result) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }
  res.json(result);
});

router.patch("/accounts/:id", async (req, res): Promise<void> => {
  const params = UpdateAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const user = getRequestUser(req);
  const orgId = user.orgId!;
  const [existing] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.orgId, orgId)));
  if (!existing) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }

  const updateData: Partial<typeof accountsTable.$inferInsert> = {};
  if (parsed.data.label != null) updateData.label = parsed.data.label;
  if (parsed.data.email != null) updateData.email = parsed.data.email;
  if (parsed.data.status != null) updateData.status = parsed.data.status;
  if (parsed.data.startDate != null) updateData.startDate = toDateText(parsed.data.startDate);
  if (parsed.data.expiryDate != null) updateData.expiryDate = toDateText(parsed.data.expiryDate);
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.password) updateData.passwordEncrypted = encrypt(parsed.data.password);

  const nextStartDate = parsed.data.startDate != null ? toDateText(parsed.data.startDate) : existing.startDate;
  const nextExpiryDate = parsed.data.expiryDate != null ? toDateText(parsed.data.expiryDate) : existing.expiryDate;
  if (nextExpiryDate < nextStartDate) {
    res.status(400).json({ error: "تاريخ انتهاء الحساب يجب أن يكون بعد تاريخ البداية" });
    return;
  }

  if (parsed.data.capacity != null && parsed.data.capacity !== existing.capacity) {
    const newCapacity = parsed.data.capacity;
    const currentSlots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.accountId, params.data.id))
      .orderBy(slotsTable.slotIndex);
    const occupiedCount = currentSlots.filter((slot) => slot.status === "occupied").length;

    if (newCapacity < occupiedCount) {
      res.status(400).json({ error: `لا يمكن تقليل السعة إلى ${newCapacity}، يوجد ${occupiedCount} مقاعد مشغولة حاليًا` });
      return;
    }

    if (newCapacity > existing.capacity) {
      await db.insert(slotsTable).values(
        Array.from({ length: newCapacity - existing.capacity }, (_, index) => ({
          accountId: params.data.id,
          slotIndex: existing.capacity + index + 1,
          status: "free" as const,
        })),
      );
    } else {
      const freeSlots = currentSlots.filter((slot) => slot.status === "free").sort((a, b) => b.slotIndex - a.slotIndex);
      for (const slot of freeSlots.slice(0, existing.capacity - newCapacity)) {
        await db.delete(slotsTable).where(eq(slotsTable.id, slot.id));
      }
    }
    updateData.capacity = newCapacity;
  }

  await db.update(accountsTable).set(updateData).where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.orgId, orgId)));
  if (parsed.data.startDate != null || parsed.data.expiryDate != null) {
    const accountSlots = await db.select({ id: slotsTable.id }).from(slotsTable).where(eq(slotsTable.accountId, params.data.id));
    if (accountSlots.length) {
      await db.update(subscriptionsTable)
        .set({ startDate: nextStartDate, expiryDate: nextExpiryDate })
        .where(and(
          eq(subscriptionsTable.orgId, orgId),
          inArray(subscriptionsTable.slotId, accountSlots.map((slot) => slot.id)),
          eq(subscriptionsTable.status, "active"),
        ));
    }
  }
  res.json(await buildAccountWithSlots(params.data.id, orgId));
});

router.delete("/accounts/:id", async (req, res): Promise<void> => {
  const params = DeleteAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const orgId = getRequestUser(req).orgId!;
  const [account] = await db
    .delete(accountsTable)
    .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.orgId, orgId)))
    .returning();
  if (!account) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }
  res.sendStatus(204);
});

router.post("/accounts/:id/reveal-password", async (req, res): Promise<void> => {
  const params = RevealAccountPasswordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }

  const user = getRequestUser(req);
  const [account] = await db
    .select()
    .from(accountsTable)
    .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.orgId, user.orgId!)));
  if (!account) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }

  await db.insert(auditLogTable).values({
    userId: user.id,
    orgId: user.orgId!,
    action: "credential_reveal",
    entity: "account",
    entityId: account.id,
    detail: `كشف كلمة مرور الحساب: ${account.label}`,
  });

  res.json({ password: decrypt(account.passwordEncrypted) });
});

router.get("/accounts/:id/slots", async (req, res): Promise<void> => {
  const params = GetAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرف غير صالح" });
    return;
  }
  const orgId = getRequestUser(req).orgId!;
  const [account] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.id, params.data.id), eq(accountsTable.orgId, orgId)));
  if (!account) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }
  const slots = await db.select().from(slotsTable).where(eq(slotsTable.accountId, params.data.id)).orderBy(slotsTable.slotIndex);
  res.json(slots);
});

export default router;
