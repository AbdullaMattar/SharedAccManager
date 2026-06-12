import { Router, type IRouter } from "express";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setSession, clearSession, requireAuth } from "../lib/session";
import { LoginBody, RegisterBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  const { email, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));

  if (!user || user.disabled) {
    // If user exists but is disabled, log the attempt
    if (user && user.disabled) {
      db.insert(auditLogTable)
        .values({
          userId: user.id,
          action: "login_failed",
          entity: "user",
          entityId: user.id,
          detail: "محاولة دخول لحساب معطل",
        })
        .run();
    }
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    db.insert(auditLogTable)
      .values({
        userId: user.id,
        action: "login_failed",
        entity: "user",
        entityId: user.id,
        detail: "كلمة مرور خاطئة",
      })
      .run();
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  setSession(res, user.id);
  
  db.insert(auditLogTable)
    .values({
      userId: user.id,
      action: "login_success",
      entity: "user",
      entityId: user.id,
      detail: "تسجيل دخول ناجح",
    })
    .run();

  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "بيانات غير صالحة" });
    return;
  }

  const { name, email, password } = parsed.data;
  try {
    const user = db.transaction((tx) => {
      const created = tx
        .insert(usersTable)
        .values({
          name,
          email,
          role: "staff",
          passwordHash: bcrypt.hashSync(password, 12),
        })
        .returning()
        .get();
      tx.insert(auditLogTable)
        .values({
          userId: created.id,
          action: "user_register",
          entity: "user",
          entityId: created.id,
          detail: `تسجيل حساب جديد: ${created.name}`,
        })
        .run();
      return created;
    });

    setSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
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
  const user = (req as unknown as { user: typeof usersTable.$inferSelect }).user;
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
});

export default router;
