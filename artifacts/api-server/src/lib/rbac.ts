import type { NextFunction, Request, Response } from "express";
import { getRequestUser } from "./request-user";

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (getRequestUser(req).role !== "admin") {
    res.status(403).json({ error: "هذه العملية متاحة للمدير فقط" });
    return;
  }
  next();
}
