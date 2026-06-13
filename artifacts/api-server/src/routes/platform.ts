import { Router, type IRouter, type Request, type Response } from "express";
import {
  accountsTable,
  auditLogTable,
  customersTable,
  db,
  organizationsTable,
  paymentsTable,
  passwordResetSchema,
  productsTable,
  settingsTable,
  subscriptionsTable,
  usersTable,
  validationError,
  idParamsSchema,
} from "@workspace/db";
import { and, asc, eq, inArray, min, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { requireAuth } from "../lib/session";
import { requireSuperadmin } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();
const DEMO_ORG_ID = 1;

router.use("/platform", requireAuth, requireSuperadmin);

async function buildPlatformOrg(organizationId: number) {
  const organization = await db.select().from(organizationsTable).where(eq(organizationsTable.id, organizationId)).get();
  if (!organization) return null;
  const [owner, usersCount, productsCount, accountsCount, customersCount, subscriptionsCount, paymentsCount] = await Promise.all([
    db.select({ email: usersTable.email })
      .from(usersTable)
      .where(and(eq(usersTable.orgId, organization.id), eq(usersTable.role, "admin")))
      .orderBy(asc(usersTable.createdAt))
      .get(),
    db.select({ count: sql<number>`count(*)` }).from(usersTable).where(eq(usersTable.orgId, organization.id)).get(),
    db.select({ count: sql<number>`count(*)` }).from(productsTable).where(eq(productsTable.orgId, organization.id)).get(),
    db.select({ count: sql<number>`count(*)` }).from(accountsTable).where(eq(accountsTable.orgId, organization.id)).get(),
    db.select({ count: sql<number>`count(*)` }).from(customersTable).where(eq(customersTable.orgId, organization.id)).get(),
    db.select({ count: sql<number>`count(*)` }).from(subscriptionsTable).where(eq(subscriptionsTable.orgId, organization.id)).get(),
    db.select({ count: sql<number>`count(*)` }).from(paymentsTable).where(eq(paymentsTable.orgId, organization.id)).get(),
  ]);

  return {
    id: organization.id,
    name: organization.name,
    status: organization.status,
    createdAt: organization.createdAt,
    ownerEmail: owner?.email ?? null,
    usersCount: usersCount?.count ?? 0,
    productsCount: productsCount?.count ?? 0,
    accountsCount: accountsCount?.count ?? 0,
    customersCount: customersCount?.count ?? 0,
    subscriptionsCount: subscriptionsCount?.count ?? 0,
    paymentsCount: paymentsCount?.count ?? 0,
  };
}

router.get("/platform/orgs", async (_req, res): Promise<void> => {
  const organizations = await db.select({ id: organizationsTable.id }).from(organizationsTable).orderBy(asc(organizationsTable.createdAt));
  const rows = await Promise.all(organizations.map((organization) => buildPlatformOrg(organization.id)));
  res.json(rows.filter(Boolean));
});

function orgStatusHandler(nextStatus: "active" | "suspended", action: "platform_suspend_org" | "platform_unsuspend_org") {
  return async (req: Request, res: Response): Promise<void> => {
    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: validationError(params.error) });
      return;
    }
    if (params.data.id === DEMO_ORG_ID) {
      res.status(400).json({ error: "لا يمكن تغيير حالة النشاط التجريبي" });
      return;
    }

    const actor = getRequestUser(req);
    const updated = db.transaction((tx) => {
      const organization = tx.update(organizationsTable)
        .set({ status: nextStatus })
        .where(eq(organizationsTable.id, params.data.id))
        .returning()
        .get();
      if (!organization) return null;
      tx.insert(auditLogTable).values({
        userId: actor.id,
        orgId: null,
        action,
        entity: "organization",
        entityId: organization.id,
        detail: `${nextStatus === "suspended" ? "تعليق" : "إعادة تفعيل"} النشاط: ${organization.name}`,
      }).run();
      return organization.id;
    });

    if (!updated) {
      res.status(404).json({ error: "النشاط غير موجود" });
      return;
    }
    res.json(await buildPlatformOrg(updated));
  };
}

router.post("/platform/orgs/:id/suspend", orgStatusHandler("suspended", "platform_suspend_org"));
router.post("/platform/orgs/:id/unsuspend", orgStatusHandler("active", "platform_unsuspend_org"));

router.post("/platform/orgs/:id/reset-owner-password", async (req: Request, res: Response): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }
  if (params.data.id === DEMO_ORG_ID) {
    res.status(400).json({ error: "لا يمكن تعديل مستخدم النشاط التجريبي" });
    return;
  }
  const parsed = passwordResetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const actor = getRequestUser(req);
  const owner = await db
    .select({ id: usersTable.id, email: usersTable.email, orgId: usersTable.orgId })
    .from(usersTable)
    .where(and(eq(usersTable.orgId, params.data.id), eq(usersTable.role, "admin")))
    .orderBy(asc(usersTable.createdAt))
    .get();

  if (!owner) {
    res.status(404).json({ error: "لم يتم العثور على مالك النشاط" });
    return;
  }

  const org = await db
    .select({ name: organizationsTable.name })
    .from(organizationsTable)
    .where(eq(organizationsTable.id, params.data.id))
    .get();

  db.transaction((tx) => {
    tx.update(usersTable)
      .set({ passwordHash: bcrypt.hashSync(parsed.data.password, 12) })
      .where(eq(usersTable.id, owner.id))
      .run();
    tx.insert(auditLogTable).values({
      userId: actor.id,
      orgId: null,
      action: "platform_reset_owner_password",
      entity: "user",
      entityId: owner.id,
      detail: `إعادة تعيين كلمة مرور مالك النشاط: ${org?.name ?? ""} (${owner.email})`,
    }).run();
  });

  res.json({ ok: true });
});

router.delete("/platform/orgs/:id", async (req: Request, res: Response): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }
  const orgId = params.data.id;
  if (orgId === DEMO_ORG_ID) {
    res.status(400).json({ error: "لا يمكن حذف النشاط التجريبي" });
    return;
  }

  const actor = getRequestUser(req);
  const deletedName = db.transaction((tx) => {
    const organization = tx.select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .get();
    if (!organization) return null;

    const orgUserIds = tx.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.orgId, orgId))
      .all()
      .map((u) => u.id);

    tx.delete(paymentsTable).where(eq(paymentsTable.orgId, orgId)).run();
    tx.delete(subscriptionsTable).where(eq(subscriptionsTable.orgId, orgId)).run();
    tx.delete(accountsTable).where(eq(accountsTable.orgId, orgId)).run();
    tx.delete(productsTable).where(eq(productsTable.orgId, orgId)).run();
    tx.delete(customersTable).where(eq(customersTable.orgId, orgId)).run();
    tx.delete(settingsTable).where(eq(settingsTable.orgId, orgId)).run();
    if (orgUserIds.length > 0) {
      tx.delete(auditLogTable)
        .where(or(eq(auditLogTable.orgId, orgId), inArray(auditLogTable.userId, orgUserIds)))
        .run();
    } else {
      tx.delete(auditLogTable).where(eq(auditLogTable.orgId, orgId)).run();
    }
    tx.delete(usersTable).where(eq(usersTable.orgId, orgId)).run();
    tx.delete(organizationsTable).where(eq(organizationsTable.id, orgId)).run();

    tx.insert(auditLogTable).values({
      userId: actor.id,
      orgId: null,
      action: "platform_delete_org",
      entity: "organization",
      entityId: orgId,
      detail: `حذف النشاط: ${organization.name}`,
    }).run();
    return organization.name;
  });

  if (!deletedName) {
    res.status(404).json({ error: "النشاط غير موجود" });
    return;
  }
  res.json({ ok: true });
});

export default router;
