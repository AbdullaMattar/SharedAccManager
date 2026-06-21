import { Router, type IRouter } from "express";
import multer from "multer";
import { mkdirSync } from "fs";
import path from "path";
import {
  auditLogTable,
  db,
  idParamsSchema,
  productsTable,
  settingsTable,
  validationError,
  websiteUpdateSchema,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireAdmin, requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import {
  assertStoreSlugAvailable,
  deleteProductImageFile,
  getProductStoreMeta,
  getWebsiteConfig,
  isValidWhatsapp,
  productDescriptionKey,
  productImageKey,
  productNameKey,
  STORE_DESCRIPTION_KEY,
  STORE_ENABLED_KEY,
  STORE_IMAGES_DIR,
  STORE_NAME_KEY,
  STORE_SLUG_KEY,
  STORE_WHATSAPP_KEY,
  upsertSetting,
} from "../lib/store-settings";

const router: IRouter = Router();

router.use("/website", requireAuth, requireOrgUser, requireAdmin);

const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE = 2 * 1024 * 1024;

mkdirSync(STORE_IMAGES_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, STORE_IMAGES_DIR),
    filename: (req, file, cb) => {
      const user = getRequestUser(req);
      const params = idParamsSchema.safeParse(req.params);
      const productId = params.success ? params.data.id : 0;
      const ext = file.mimetype === "image/png" ? "png" : file.mimetype === "image/webp" ? "webp" : "jpg";
      cb(null, `${user.orgId}-${productId}.${ext}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("نوع الملف غير مدعوم. يُقبل فقط: JPG, PNG, WebP"));
    }
  },
});

router.get("/website", async (req, res): Promise<void> => {
  const orgId = getRequestUser(req).orgId!;
  const [config, products] = await Promise.all([
    getWebsiteConfig(orgId),
    getProductStoreMeta(orgId),
  ]);
  if (!config) {
    res.status(404).json({ error: "النشاط غير موجود" });
    return;
  }
  res.json({ ...config, products });
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

  const [config, products] = await Promise.all([
    getWebsiteConfig(orgId),
    getProductStoreMeta(orgId),
  ]);
  res.json({ ...config, products });
});

router.patch("/website/products/:id", async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }

  const { name, description } = req.body as { name?: unknown; description?: unknown };
  if (name === undefined && description === undefined) {
    res.status(400).json({ error: "يجب إرسال اسم أو وصف على الأقل" });
    return;
  }

  const user = getRequestUser(req);
  const orgId = user.orgId!;
  const productId = params.data.id;

  const product = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), eq(productsTable.orgId, orgId)))
    .get();

  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }

  db.transaction((tx) => {
    if (typeof name === "string") {
      upsertSetting(tx, orgId, productNameKey(productId), name.trim());
    }
    if (typeof description === "string") {
      upsertSetting(tx, orgId, productDescriptionKey(productId), description.trim());
    }
  });

  const meta = await getProductStoreMeta(orgId);
  res.json(meta.find((m) => m.id === productId) ?? null);
});

router.post(
  "/website/products/:id/image",
  (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "حجم الصورة يتجاوز الحد الأقصى البالغ 2 ميغابايت" });
        return;
      }
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : "خطأ في رفع الصورة" });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const cleanupFile = () => {
      if (req.file) deleteProductImageFile(req.file.filename);
    };

    const params = idParamsSchema.safeParse(req.params);
    if (!params.success) {
      cleanupFile();
      res.status(400).json({ error: validationError(params.error) });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: "لم يتم إرسال صورة" });
      return;
    }

    const orgId = getRequestUser(req).orgId!;
    const productId = params.data.id;

    const product = await db
      .select({ id: productsTable.id })
      .from(productsTable)
      .where(and(eq(productsTable.id, productId), eq(productsTable.orgId, orgId)))
      .get();

    if (!product) {
      cleanupFile();
      res.status(404).json({ error: "المنتج غير موجود" });
      return;
    }

    const key = productImageKey(productId);
    const existingRow = await db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(and(eq(settingsTable.orgId, orgId), eq(settingsTable.key, key)))
      .get();

    if (existingRow?.value && existingRow.value !== req.file.filename) {
      deleteProductImageFile(existingRow.value);
    }

    db.transaction((tx) => {
      upsertSetting(tx, orgId, key, req.file!.filename);
    });

    res.json({ imageUrl: `/store-images/${req.file.filename}` });
  },
);

router.delete("/website/products/:id/image", async (req, res): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }

  const orgId = getRequestUser(req).orgId!;
  const productId = params.data.id;
  const key = productImageKey(productId);

  const product = await db
    .select({ id: productsTable.id })
    .from(productsTable)
    .where(and(eq(productsTable.id, productId), eq(productsTable.orgId, orgId)))
    .get();

  if (!product) {
    res.status(404).json({ error: "المنتج غير موجود" });
    return;
  }

  const existing = await db
    .select({ value: settingsTable.value })
    .from(settingsTable)
    .where(and(eq(settingsTable.orgId, orgId), eq(settingsTable.key, key)))
    .get();

  if (existing?.value) {
    deleteProductImageFile(existing.value);
    db.transaction((tx) => {
      tx.delete(settingsTable).where(and(eq(settingsTable.orgId, orgId), eq(settingsTable.key, key))).run();
    });
  }

  res.json({ ok: true });
});

export default router;
