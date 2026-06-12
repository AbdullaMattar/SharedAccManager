import { Router, type IRouter } from "express";
import { auditLogTable, db, organizationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import {
  clearSession,
  getSuspendedOrgError,
  requireAuth,
  setSession,
} from "../lib/session";
import { getRequestUser } from "../lib/request-user";
import { LoginBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  const { email, password } = parsed.data;
  const [row] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
      role: usersTable.role,
      orgId: usersTable.orgId,
      disabled: usersTable.disabled,
      orgName: organizationsTable.name,
      orgStatus: organizationsTable.status,
    })
    .from(usersTable)
    .leftJoin(organizationsTable, eq(usersTable.orgId, organizationsTable.id))
    .where(eq(usersTable.email, email));

  if (!row || row.disabled) {
    if (row?.disabled) {
      db.insert(auditLogTable)
        .values({
          userId: row.id,
          orgId: row.orgId,
          action: "login_failed",
          entity: "user",
          entityId: row.id,
          detail: "محاولة دخول لحساب معطل",
        })
        .run();
    }
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  if (row.orgId != null && row.orgStatus === "suspended") {
    res.status(401).json({ error: getSuspendedOrgError() });
    return;
  }

  const valid = await bcrypt.compare(password, row.passwordHash);
  if (!valid) {
    db.insert(auditLogTable)
      .values({
        userId: row.id,
        orgId: row.orgId,
        action: "login_failed",
        entity: "user",
        entityId: row.id,
        detail: "كلمة مرور خاطئة",
      })
      .run();
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  setSession(res, row.id);
  db.insert(auditLogTable)
    .values({
      userId: row.id,
      orgId: row.orgId,
      action: "login_success",
      entity: "user",
      entityId: row.id,
      detail: "تسجيل دخول ناجح",
    })
    .run();

  res.json({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    orgName: row.orgName,
  });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const businessName = typeof body.businessName === "string" ? body.businessName.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!name || !businessName || !emailValid || password.length < 8) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }
  try {
    const user = db.transaction((tx) => {
      const organization = tx
        .insert(organizationsTable)
        .values({ name: businessName })
        .returning()
        .get();
      const created = tx
        .insert(usersTable)
        .values({
          name,
          email,
          role: "admin",
          orgId: organization.id,
          passwordHash: bcrypt.hashSync(password, 12),
        })
        .returning()
        .get();
      tx.insert(auditLogTable)
        .values({
          userId: created.id,
          orgId: organization.id,
          action: "user_register",
          entity: "user",
          entityId: created.id,
          detail: `تسجيل حساب جديد: ${created.name}`,
        })
        .run();
      return {
        id: created.id,
        name: created.name,
        email: created.email,
        role: created.role,
        orgName: organization.name,
      };
    });

    setSession(res, user.id);
    res.json(user);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed: users.email")) {
      res.status(409).json({ error: "البريد الإلكتروني مستخدم بالفعل" });
      return;
    }
    throw error;
  }
});

router.post("/auth/logout", (_req, res): void => {
  clearSession(res);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, (req, res): void => {
  const user = getRequestUser(req);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    orgName: user.orgName,
  });
});

export default router;
