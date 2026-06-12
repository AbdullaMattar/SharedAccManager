import type { Request } from "express";
import type { AuthenticatedUser } from "./session";

export function getRequestUser(req: Request): AuthenticatedUser {
  return (req as Request & { user: AuthenticatedUser }).user;
}
