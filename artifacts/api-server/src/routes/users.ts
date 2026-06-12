import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import {
  auditLogTable,
  db,
  idParamsSchema,
  passwordResetSchema,
  userCreateSchema,
  usersTable,
  userUpdateSchema,
  validationError,
} from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireAdmin, requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";

const router: IRouter = Router();
const publicUser = {
  id: usersTable.id,
  name: usersTable.name,
  email: usersTable.email,
  role: usersTable.role,
  disabled: usersTable.disabled,
  createdAt: usersTable.createdAt,
};

function isProtectedDemoUser(email: string): boolean {
  return email === "admin@example.com" || email === "staff@example.com";
}

router.use("/users", requireAuth, requireOrgUser, requireAdmin);

router.get("/users", async (req, res): Promise<void> => {
  const orgId = getRequestUser(req).orgId!;
  res.json(
    await db
      .select(publicUser)
      .from(usersTable)
      .where(eq(usersTable.orgId, orgId))
      .orderBy(asc(usersTable.name)),
  );
});

router.post("/users", async (req, res): Promise<void> => {
  const parsed = userCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }
  const actor = getRequestUser(req);
  try {
    const created = db.transaction((tx) => {
      const user = tx.insert(usersTable).values({
        name: parsed.data.name,
        email: parsed.data.email,
        role: parsed.data.role,
        orgId: actor.orgId!,
        passwordHash: bcrypt.hashSync(parsed.data.password, 12),
      }).returning().get();
      tx.insert(auditLogTable).values({
        userId: actor.id,
        orgId: actor.orgId!,
        action: "user_create",
        entity: "user",
        entityId: user.id,
        detail: `إنشاء المستخدم: ${user.name}`,
      }).run();
      return user;
    });
    const { passwordHash: _passwordHash, ...safe } = created;
    res.status(201).json(safe);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) {
      res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
      return;
    }
    throw error;
  }
});

router.patch("/users/:id", async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  const parsed = userUpdateSchema.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }
  const actor = getRequestUser(req);
  const [target] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, params.data.id), eq(usersTable.orgId, actor.orgId!)));
  if (!target) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }
  if (isProtectedDemoUser(target.email)) {
    res.status(403).json({ error: "لا يمكن تعديل مستخدم العرض التجريبي" });
    return;
  }
  if (actor.id === target.id && (parsed.data.disabled || parsed.data.role === "staff")) {
    res.status(409).json({ error: "لا يمكنك تعطيل حسابك أو إزالة صلاحية المدير منه" });
    return;
  }
  const user = db.transaction((tx) => {
    const updated = tx.update(usersTable)
      .set(parsed.data)
      .where(and(eq(usersTable.id, target.id), eq(usersTable.orgId, actor.orgId!)))
      .returning()
      .get();
    if (!updated) return null;
    tx.insert(auditLogTable).values({
      userId: actor.id,
      orgId: actor.orgId!,
      action: "user_update",
      entity: "user",
      entityId: updated.id,
      detail: `تحديث المستخدم: ${updated.name}`,
    }).run();
    return updated;
  });
  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }
  const { passwordHash: _passwordHash, ...safe } = user;
  res.json(safe);
});

router.post("/users/:id/reset-password", async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  const parsed = passwordResetSchema.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }
  const actor = getRequestUser(req);
  const [target] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.id, params.data.id), eq(usersTable.orgId, actor.orgId!)));
  if (!target) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }
  if (isProtectedDemoUser(target.email)) {
    res.status(403).json({ error: "لا يمكن إعادة تعيين كلمة مرور مستخدم العرض التجريبي" });
    return;
  }
  const user = db.transaction((tx) => {
    const updated = tx.update(usersTable)
      .set({ passwordHash: bcrypt.hashSync(parsed.data.password, 12) })
      .where(and(eq(usersTable.id, target.id), eq(usersTable.orgId, actor.orgId!)))
      .returning()
      .get();
    if (!updated) return null;
    tx.insert(auditLogTable).values({
      userId: actor.id,
      orgId: actor.orgId!,
      action: "user_password_reset",
      entity: "user",
      entityId: updated.id,
      detail: `إعادة تعيين كلمة مرور المستخدم: ${updated.name}`,
    }).run();
    return updated;
  });
  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }
  res.json({ ok: true });
});

export default router;
