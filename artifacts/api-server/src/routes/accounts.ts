import { Router, type IRouter } from "express";
import { db, accountsTable, productsTable, slotsTable, auditLogTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { encrypt, decrypt } from "../lib/crypto";
import {
  GetAccountParams,
  UpdateAccountParams,
  DeleteAccountParams,
  RevealAccountPasswordParams,
  ListAccountsQueryParams,
  CreateAccountBody,
  UpdateAccountBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildAccountWithSlots(accountId: number) {
  const [account] = await db
    .select({
      id: accountsTable.id,
      productId: accountsTable.productId,
      productName: productsTable.name,
      label: accountsTable.label,
      email: accountsTable.email,
      capacity: accountsTable.capacity,
      status: accountsTable.status,
      notes: accountsTable.notes,
      createdAt: accountsTable.createdAt,
    })
    .from(accountsTable)
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(eq(accountsTable.id, accountId));

  if (!account) return null;

  const slots = await db.select().from(slotsTable).where(eq(slotsTable.accountId, accountId)).orderBy(slotsTable.slotIndex);
  const freeSlots = slots.filter((s) => s.status === "free").length;
  const occupiedSlots = slots.filter((s) => s.status === "occupied").length;

  return { ...account, slots, freeSlots, occupiedSlots };
}

router.get("/accounts", requireAuth, async (req, res): Promise<void> => {
  const queryParsed = ListAccountsQueryParams.safeParse(req.query);
  const filters = queryParsed.success ? queryParsed.data : {};

  const conditions = [];
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
      notes: accountsTable.notes,
      createdAt: accountsTable.createdAt,
    })
    .from(accountsTable)
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(accountsTable.createdAt);

  const accountsWithSlots = await Promise.all(
    accounts.map(async (a) => {
      const slots = await db.select().from(slotsTable).where(eq(slotsTable.accountId, a.id)).orderBy(slotsTable.slotIndex);
      const freeSlots = slots.filter((s) => s.status === "free").length;
      const occupiedSlots = slots.filter((s) => s.status === "occupied").length;
      return { ...a, slots, freeSlots, occupiedSlots };
    }),
  );

  res.json(accountsWithSlots);
});

router.post("/accounts", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { password, ...rest } = parsed.data;
  const passwordEncrypted = encrypt(password);

  const [account] = await db
    .insert(accountsTable)
    .values({ ...rest, passwordEncrypted })
    .returning();

  // Auto-create capacity slots
  const slotValues = Array.from({ length: account.capacity }, (_, i) => ({
    accountId: account.id,
    slotIndex: i + 1,
    status: "free" as const,
  }));
  await db.insert(slotsTable).values(slotValues);

  const result = await buildAccountWithSlots(account.id);
  res.status(201).json(result);
});

router.get("/accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = GetAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const result = await buildAccountWithSlots(params.data.id);
  if (!result) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }
  res.json(result);
});

router.patch("/accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const parsed = UpdateAccountBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(accountsTable).where(eq(accountsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }

  const updateData: Partial<typeof accountsTable.$inferInsert> = {};
  if (parsed.data.label != null) updateData.label = parsed.data.label;
  if (parsed.data.email != null) updateData.email = parsed.data.email;
  if (parsed.data.status != null) updateData.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.password) updateData.passwordEncrypted = encrypt(parsed.data.password);

  // Handle capacity change — reconcile slots
  if (parsed.data.capacity != null && parsed.data.capacity !== existing.capacity) {
    const newCapacity = parsed.data.capacity;
    const currentSlots = await db
      .select()
      .from(slotsTable)
      .where(eq(slotsTable.accountId, params.data.id))
      .orderBy(slotsTable.slotIndex);

    const occupiedCount = currentSlots.filter((s) => s.status === "occupied").length;

    if (newCapacity < occupiedCount) {
      res.status(400).json({
        error: `لا يمكن تقليل السعة إلى ${newCapacity}، يوجد ${occupiedCount} مقاعد مشغولة حالياً`,
      });
      return;
    }

    if (newCapacity > existing.capacity) {
      // Add new slots
      const newSlots = Array.from({ length: newCapacity - existing.capacity }, (_, i) => ({
        accountId: params.data.id,
        slotIndex: existing.capacity + i + 1,
        status: "free" as const,
      }));
      await db.insert(slotsTable).values(newSlots);
    } else if (newCapacity < existing.capacity) {
      // Remove free slots from the end (highest slotIndex first)
      const freeSlots = currentSlots
        .filter((s) => s.status === "free")
        .sort((a, b) => b.slotIndex - a.slotIndex);
      const toRemove = freeSlots.slice(0, existing.capacity - newCapacity);
      for (const slot of toRemove) {
        await db.delete(slotsTable).where(eq(slotsTable.id, slot.id));
      }
    }
    updateData.capacity = newCapacity;
  }

  await db.update(accountsTable).set(updateData).where(eq(accountsTable.id, params.data.id));
  const result = await buildAccountWithSlots(params.data.id);
  res.json(result);
});

router.delete("/accounts/:id", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const [account] = await db.delete(accountsTable).where(eq(accountsTable.id, params.data.id)).returning();
  if (!account) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }
  res.sendStatus(204);
});

router.post("/accounts/:id/reveal-password", requireAuth, async (req, res): Promise<void> => {
  const params = RevealAccountPasswordParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }

  const [account] = await db.select().from(accountsTable).where(eq(accountsTable.id, params.data.id));
  if (!account) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }

  const password = decrypt(account.passwordEncrypted);

  // Write audit log
  const user = (req as unknown as { user: { id: number } }).user;
  await db.insert(auditLogTable).values({
    userId: user?.id ?? null,
    action: "credential_reveal",
    entity: "account",
    entityId: account.id,
    detail: `كشف كلمة مرور الحساب: ${account.label}`,
  });

  res.json({ password });
});

router.get("/accounts/:id/slots", requireAuth, async (req, res): Promise<void> => {
  const params = GetAccountParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "معرّف غير صالح" });
    return;
  }
  const slots = await db
    .select()
    .from(slotsTable)
    .where(eq(slotsTable.accountId, params.data.id))
    .orderBy(slotsTable.slotIndex);
  res.json(slots);
});

export default router;
