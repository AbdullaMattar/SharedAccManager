import { Router, type IRouter } from "express";
import { db, accountsTable, productsTable, slotsTable, auditLogTable, usersTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { ListAuditLogQueryParams } from "@workspace/api-zod";
import { requireAdmin } from "../lib/rbac";

const router: IRouter = Router();

router.get("/stats/inventory", requireAuth, async (_req, res): Promise<void> => {
  const [products, accounts, slots] = await Promise.all([
    db.select().from(productsTable),
    db.select().from(accountsTable),
    db.select().from(slotsTable),
  ]);

  const totalProducts = products.length;
  const totalAccounts = accounts.length;
  const totalSlots = slots.length;
  const freeSlots = slots.filter((s) => s.status === "free").length;
  const occupiedSlots = slots.filter((s) => s.status === "occupied").length;

  const accountsByStatus = {
    active: accounts.filter((a) => a.status === "active").length,
    disabled: accounts.filter((a) => a.status === "disabled").length,
    needs_attention: accounts.filter((a) => a.status === "needs_attention").length,
  };

  res.json({ totalProducts, totalAccounts, totalSlots, freeSlots, occupiedSlots, accountsByStatus });
});

router.get("/stats/audit-log", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const queryParsed = ListAuditLogQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 50) : 50;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;

  const entries = await db
    .select({
      id: auditLogTable.id,
      userId: auditLogTable.userId,
      userName: usersTable.name,
      action: auditLogTable.action,
      entity: auditLogTable.entity,
      entityId: auditLogTable.entityId,
      detail: auditLogTable.detail,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.userId, usersTable.id))
    .where(action ? eq(auditLogTable.action, action) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);

  res.json(entries);
});

export default router;
