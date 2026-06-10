import { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "crypto";

const SESSION_COOKIE = "sam_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET environment variable is required");
  return s;
}

export interface SessionPayload {
  userId: number;
  exp: number;
}

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
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
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
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, payload.userId));
  if (!user || user.disabled) {
    res.status(401).json({ error: "المستخدم غير موجود" });
    return;
  }
  (req as Request & { user: typeof user }).user = user;
  next();
}

export function getSessionToken(req: Request): SessionPayload | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  return verify(token);
}
