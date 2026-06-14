import { Router, type IRouter } from "express";
import { db, auditLogTable } from "@workspace/db";
import { requireAuth } from "../lib/session";
import { requireOrgUser, requireAdmin } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import { exportOrgBackup } from "../lib/backup-export";

const router: IRouter = Router();

router.use("/backup", requireAuth, requireOrgUser, requireAdmin);

router.post("/backup/export", async (req, res): Promise<void> => {
  const passphrase = typeof req.body?.passphrase === "string" ? req.body.passphrase : "";
  if (passphrase.length < 8) {
    res.status(400).json({ error: "كلمة المرور يجب أن تكون 8 أحرف على الأقل" });
    return;
  }

  const user = getRequestUser(req);
  const orgId = user.orgId!;

  try {
    const { buffer, orgName } = await exportOrgBackup(db, orgId, passphrase);

    await db.insert(auditLogTable).values({
      userId: user.id,
      orgId,
      action: "data_export",
      entity: "organization",
      entityId: orgId,
      detail: "تنزيل نسخة احتياطية مشفّرة",
    });

    const date = new Date().toISOString().slice(0, 10);
    const safe = (orgName ?? "backup").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="backup-${date}.xlsx"; filename*=UTF-8''backup-${encodeURIComponent(safe)}-${date}.xlsx`,
    );
    res.send(buffer);
  } catch (err) {
    req.log?.error({ err }, "data export failed");
    res.status(500).json({ error: "تعذّر إنشاء النسخة الاحتياطية" });
  }
});

export default router;
