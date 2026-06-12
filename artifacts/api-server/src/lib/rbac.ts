import type { NextFunction, Request, Response } from "express";
import { getRequestUser } from "./request-user";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).role !== "admin") {
    res.status(403).json({ error: "هذه العملية متاحة للمدير فقط" });
    return;
  }
  next();
}

export function requireOrgUser(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).orgId == null) {
    res.status(403).json({ error: "هذه العملية متاحة لحسابات الأنشطة فقط" });
    return;
  }
  next();
}

export function requireSuperadmin(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).role !== "superadmin") {
    res.status(403).json({ error: "هذه العملية متاحة لمدير المنصة فقط" });
    return;
  }
  next();
}
