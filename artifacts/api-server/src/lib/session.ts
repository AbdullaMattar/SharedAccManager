import { Request, Response, NextFunction } from "express";
import { db, organizationsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "sam_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SUSPENDED_ORG_ERROR = "تم إيقاف حسابكم - يرجى التواصل مع الإدارة";

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable is required");
  return s;
}

export interface SessionPayload {
  userId: number;
  exp: number;
}

export type AuthenticatedUser = typeof usersTable.$inferSelect & {
  orgName: string | null;
};

function sign(payload: SessionPayload): string {
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString("base64url");
  const hmac = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${hmac}`;
}

function verify(token: string): SessionPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  try {
    const expectedBuf = Buffer.from(expected);
    const sigBuf = Buffer.from(sig);
    if (expectedBuf.length !== sigBuf.length) return null;
    if (!timingSafeEqual(expectedBuf, sigBuf)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSession(res: Response, userId: number): void {
  const payload: SessionPayload = {
    userId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS,
  };
  const token = sign(payload);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS * 1000,
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    res.status(401).json({ error: "غير مصرح" });
    return;
  }

  const payload = verify(token);
  if (!payload) {
    res.status(401).json({ error: "انتهت الجلسة، يرجى تسجيل الدخول مجددًا" });
    return;
  }

  const [row] = await db
    .select({
      id: usersTable.id,
      name: usersTable.name,
      email: usersTable.email,
      passwordHash: usersTable.passwordHash,
      role: usersTable.role,
      orgId: usersTable.orgId,
      disabled: usersTable.disabled,
      createdAt: usersTable.createdAt,
      orgName: organizationsTable.name,
      orgStatus: organizationsTable.status,
    })
    .from(usersTable)
    .leftJoin(organizationsTable, eq(usersTable.orgId, organizationsTable.id))
    .where(eq(usersTable.id, payload.userId));

  if (!row || row.disabled) {
    res.status(401).json({ error: "المستخدم غير موجود" });
    return;
  }

  if (row.orgId != null && row.orgStatus === "suspended") {
    res.status(401).json({ error: SUSPENDED_ORG_ERROR });
    return;
  }

  const user: AuthenticatedUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    orgId: row.orgId,
    disabled: row.disabled,
    createdAt: row.createdAt,
    orgName: row.orgName,
  };

  (req as Request & { user: AuthenticatedUser }).user = user;
  next();
}

export function getSessionToken(req: Request): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  return verify(token);
}

export function getSuspendedOrgError(): string {
  return SUSPENDED_ORG_ERROR;
}
