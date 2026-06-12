import { Router, type IRouter } from "express";
import { db, accountsTable, productsTable, slotsTable, auditLogTable, usersTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { ListAuditLogQueryParams } from "@workspace/api-zod";
import { requireAdmin, requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();

router.use("/stats", requireAuth, requireOrgUser);

router.get("/stats/inventory", async (req, res): Promise<void> => {
  const orgId = getRequestUser(req).orgId!;
  const [products, accounts, slotCounts] = await Promise.all([
    db.select().from(productsTable).where(eq(productsTable.orgId, orgId)),
    db.select().from(accountsTable).where(eq(accountsTable.orgId, orgId)),
    db.select({
      totalSlots: sql<number>`count(${slotsTable.id})`,
      freeSlots: sql<number>`count(case when ${slotsTable.status} = 'free' then 1 end)`,
      occupiedSlots: sql<number>`count(case when ${slotsTable.status} = 'occupied' then 1 end)`,
    })
      .from(slotsTable)
      .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
      .where(eq(accountsTable.orgId, orgId))
      .get(),
  ]);

  const accountsByStatus = {
    active: accounts.filter((account) => account.status === "active").length,
    disabled: accounts.filter((account) => account.status === "disabled").length,
    needs_attention: accounts.filter((account) => account.status === "needs_attention").length,
  };

  res.json({
    totalProducts: products.length,
    totalAccounts: accounts.length,
    totalSlots: slotCounts?.totalSlots ?? 0,
    freeSlots: slotCounts?.freeSlots ?? 0,
    occupiedSlots: slotCounts?.occupiedSlots ?? 0,
    accountsByStatus,
  });
});

router.get("/stats/audit-log", requireAdmin, async (req, res): Promise<void> => {
  const orgId = getRequestUser(req).orgId!;
  const queryParsed = ListAuditLogQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 100) : 100;
  const offset = typeof req.query.offset === "string" ? Math.max(0, Number(req.query.offset) || 0) : 0;
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
    .where(and(
      eq(auditLogTable.orgId, orgId),
      action ? eq(auditLogTable.action, action) : undefined,
    ))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json(entries);
});

export default router;
