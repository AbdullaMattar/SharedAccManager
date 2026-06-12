import { Router, type IRouter } from "express";
import { auditLogTable, db, settingsTable, settingsUpdateSchema, validationError } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { requireAdmin, requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import { getSettings } from "../lib/settings";

const router: IRouter = Router();

router.use("/settings", requireAuth, requireOrgUser);

router.get("/settings", requireAdmin, async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  res.json(await getSettings(user.orgId!));
});

router.patch("/settings", requireAdmin, async (req, res): Promise<void> => {
  const parsed = settingsUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }
  const user = getRequestUser(req);
  db.transaction((tx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      tx.insert(settingsTable)
        .values({ orgId: user.orgId!, key, value: String(value) })
        .onConflictDoUpdate({
          target: [settingsTable.orgId, settingsTable.key],
          set: { value: String(value) },
        })
        .run();
    }
    tx.insert(auditLogTable).values({
      userId: user.id,
      orgId: user.orgId!,
      action: "settings_update",
      entity: "settings",
      detail: `تحديث الإعدادات: ${Object.keys(parsed.data).join(", ")}`,
    }).run();
  });
  res.json(await getSettings(user.orgId!));
});

export default router;
