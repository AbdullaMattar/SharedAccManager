import { Router, type IRouter } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { setSession, clearSession, requireAuth } from "../lib/session";
import { LoginBody } from "@workspace/api-zod";

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
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "البريد الإلكتروني أو كلمة المرور غير صحيحة" });
    return;
  }

  setSession(res, user.id);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role });
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
