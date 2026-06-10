import type { Request } from "express";
import type { User } from "@workspace/db";

export function getRequestUser(req: Request): User {
  return (req as Request & { user: User }).user;
}
