import { Router, type IRouter } from "express";
import {
  auditLogTable,
  db,
  validationError,
  websiteUpdateSchema,
} from "@workspace/db";
import { requireAuth } from "../lib/session";
import { requireAdmin, requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import {
  assertStoreSlugAvailable,
  getWebsiteConfig,
  isValidWhatsapp,
  STORE_DESCRIPTION_KEY,
  STORE_ENABLED_KEY,
  STORE_NAME_KEY,
  STORE_SLUG_KEY,
  STORE_WHATSAPP_KEY,
  upsertSetting,
} from "../lib/store-settings";

const router: IRouter = Router();

router.use("/website", requireAuth, requireOrgUser, requireAdmin);

router.get("/website", async (req, res): Promise<void> => {
  const orgId = getRequestUser(req).orgId!;
  const config = await getWebsiteConfig(orgId);
  if (!config) {
    res.status(404).json({ error: "النشاط غير موجود" });
    return;
  }
  res.json(config);
});

router.patch("/website", async (req, res): Promise<void> => {
  const parsed = websiteUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const user = getRequestUser(req);
  const orgId = user.orgId!;
  const current = await getWebsiteConfig(orgId);
  if (!current) {
    res.status(404).json({ error: "النشاط غير موجود" });
    return;
  }

  const next = {
    enabled: parsed.data.enabled ?? current.enabled,
    slug: parsed.data.slug ?? current.slug,
    whatsapp: parsed.data.whatsapp ?? current.whatsapp,
    name: parsed.data.name ?? current.name,
    description: parsed.data.description ?? current.description,
  };

  if (parsed.data.slug !== undefined) {
    const available = await assertStoreSlugAvailable(parsed.data.slug, orgId);
    if (!available) {
      res.status(409).json({ error: "رابط المتجر مستخدم من نشاط آخر" });
      return;
    }
  }

  if (next.enabled && !current.platformEnabled) {
    res.status(403).json({ error: "ميزة الموقع غير متاحة لهذا النشاط حالياً" });
    return;
  }

  if (next.enabled && (!next.slug || !isValidWhatsapp(next.whatsapp))) {
    res.status(400).json({ error: "يجب إدخال رابط متجر ورقم واتساب صحيح قبل تفعيل الموقع" });
    return;
  }

  db.transaction((tx) => {
    if (parsed.data.enabled !== undefined) {
      upsertSetting(tx, orgId, STORE_ENABLED_KEY, String(parsed.data.enabled));
    }
    if (parsed.data.slug !== undefined) {
      upsertSetting(tx, orgId, STORE_SLUG_KEY, parsed.data.slug);
    }
    if (parsed.data.whatsapp !== undefined) {
      upsertSetting(tx, orgId, STORE_WHATSAPP_KEY, parsed.data.whatsapp);
    }
    if (parsed.data.name !== undefined) {
      upsertSetting(tx, orgId, STORE_NAME_KEY, parsed.data.name);
    }
    if (parsed.data.description !== undefined) {
      upsertSetting(tx, orgId, STORE_DESCRIPTION_KEY, parsed.data.description);
    }

    tx.insert(auditLogTable).values({
      userId: user.id,
      orgId,
      action: "website_settings_update",
      entity: "settings",
      detail: `تحديث إعدادات الموقع: ${Object.keys(parsed.data).join(", ")}`,
    }).run();
  });

  res.json(await getWebsiteConfig(orgId));
});

export default router;
