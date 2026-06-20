# Public Store Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public `/store/:slug` catalog page per organization with WhatsApp CTAs, platform-level website access control, and org-admin website configuration.

**Architecture:** Use the existing per-org `settings` table for website configuration, with code-enforced unique slugs and no database migration. Add small backend helpers for store settings, public visibility, slug validation, WhatsApp normalization, and availability counts; expose public, org-admin, and platform-owner API routes. Add focused React pages for the public store, org-admin Website settings, and platform Website access control.

**Tech Stack:** TypeScript, pnpm workspaces, Express 5, Drizzle ORM, SQLite/better-sqlite3, Zod v4, React 19, Vite, Wouter, TanStack Query, shadcn/Radix UI, Tailwind.

---

## Ground Rules

- Do not run git commands from this plan. The user handles staging, commits, and branch state.
- Do not add automated tests for this feature. Verification is typecheck/build only by user decision.
- Do not add a database migration. Website config uses existing `settings`.
- Keep public API responses free of account credentials, customer data, staff data, subscription data, audit data, and internal status details.
- Arabic/RTL copy belongs in `artifacts/accounts-manager/src/lib/strings.ts`.

## File Structure

- Modify: `lib/db/src/schema/phase3-validation.ts` - add website/platform validation schemas.
- Create: `artifacts/api-server/src/lib/store-settings.ts` - settings defaults, normalization, slug uniqueness, public product availability helpers.
- Create: `artifacts/api-server/src/routes/store.ts` - public `GET /api/store/:slug`.
- Create: `artifacts/api-server/src/routes/website.ts` - org-admin `GET/PATCH /api/website`.
- Modify: `artifacts/api-server/src/routes/platform.ts` - add platform website access endpoints.
- Modify: `artifacts/api-server/src/routes/index.ts` - register new routers.
- Modify: `lib/api-spec/openapi.yaml` - add store/website/platform website paths and schemas.
- Regenerate: `lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*` by running API spec codegen.
- Modify: `artifacts/accounts-manager/src/lib/phase3-api.ts` - add website/store API types and hooks.
- Modify: `artifacts/accounts-manager/src/lib/strings.ts` - add website/store strings.
- Create: `artifacts/accounts-manager/src/pages/store.tsx` - public store page.
- Create: `artifacts/accounts-manager/src/pages/website.tsx` - org-admin Website page.
- Create: `artifacts/accounts-manager/src/pages/platform-websites.tsx` - platform website access page.
- Modify: `artifacts/accounts-manager/src/App.tsx` - add routes.
- Modify: `artifacts/accounts-manager/src/components/layout.tsx` - add nav links.

---

### Task 1: Add Website Validation Schemas

**Files:**
- Modify: `lib/db/src/schema/phase3-validation.ts`

- [ ] **Step 1: Add constants and schemas**

At the end of `lib/db/src/schema/phase3-validation.ts`, append:

```ts
export const storeSlugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const storeSlugParamsSchema = z.object({
  slug: z.string().trim().toLowerCase().min(3).max(64).regex(
    storeSlugRegex,
    "رابط المتجر يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطات فقط",
  ),
});

export const websiteUpdateSchema = z
  .object({
    enabled: z.boolean().optional(),
    slug: z.preprocess(
      (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
      z.string().min(3).max(64).regex(
        storeSlugRegex,
        "رابط المتجر يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطات فقط",
      ).optional(),
    ),
    whatsapp: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().min(1, "رقم واتساب مطلوب").max(30).optional(),
    ),
    name: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().max(120).optional(),
    ),
    description: z.preprocess(
      (value) => (typeof value === "string" ? value.trim() : value),
      z.string().max(300).optional(),
    ),
  })
  .refine((value) => Object.keys(value).length > 0, "يجب إرسال تعديل واحد على الأقل");

export const platformWebsiteUpdateSchema = z.object({
  platformEnabled: z.boolean(),
});
```

- [ ] **Step 2: Typecheck the shared DB package**

Run:

```bash
pnpm --filter @workspace/db run typecheck
```

Expected: PASS.

- [ ] **Step 3: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 2: Add Store Settings Backend Helper

**Files:**
- Create: `artifacts/api-server/src/lib/store-settings.ts`

- [ ] **Step 1: Create the helper file**

Create `artifacts/api-server/src/lib/store-settings.ts` with:

```ts
import { and, asc, eq, sql } from "drizzle-orm";
import {
  accountsTable,
  db,
  organizationsTable,
  productsTable,
  settingsTable,
  slotsTable,
} from "@workspace/db";

export const STORE_PLATFORM_ENABLED_KEY = "store_platform_enabled";
export const STORE_ENABLED_KEY = "store_enabled";
export const STORE_SLUG_KEY = "store_slug";
export const STORE_WHATSAPP_KEY = "store_whatsapp";
export const STORE_NAME_KEY = "store_name";
export const STORE_DESCRIPTION_KEY = "store_description";

const STORE_KEYS = [
  STORE_PLATFORM_ENABLED_KEY,
  STORE_ENABLED_KEY,
  STORE_SLUG_KEY,
  STORE_WHATSAPP_KEY,
  STORE_NAME_KEY,
  STORE_DESCRIPTION_KEY,
] as const;

type StoreKey = typeof STORE_KEYS[number];
type SettingRow = Pick<typeof settingsTable.$inferSelect, "key" | "value">;

export type WebsiteConfig = {
  platformEnabled: boolean;
  enabled: boolean;
  slug: string;
  whatsapp: string;
  name: string;
  description: string;
  publicUrl: string | null;
};

export type PublicStoreProduct = {
  id: number;
  name: string;
  service: string;
  price: number;
  durationDays: number;
  freeSlotCount: number;
  available: boolean;
};

export type PublicStorePayload = {
  name: string;
  description: string;
  whatsappNumber: string;
  currency: string;
  products: PublicStoreProduct[];
};

export function parseStoreBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return value === "true";
}

export function normalizeWhatsapp(value: string): string {
  return value.trim().replace(/[\s-]/g, "").replace(/^\+/, "");
}

export function isValidWhatsapp(value: string): boolean {
  return /^\d{8,15}$/.test(normalizeWhatsapp(value));
}

function rowsToMap(rows: SettingRow[]): Partial<Record<StoreKey, string>> {
  const values: Partial<Record<StoreKey, string>> = {};
  for (const row of rows) {
    if ((STORE_KEYS as readonly string[]).includes(row.key)) {
      values[row.key as StoreKey] = row.value;
    }
  }
  return values;
}

export function resolveWebsiteConfig(rows: SettingRow[], orgName: string): WebsiteConfig {
  const values = rowsToMap(rows);
  const slug = (values.store_slug ?? "").trim().toLowerCase();
  const whatsapp = values.store_whatsapp ? normalizeWhatsapp(values.store_whatsapp) : "";
  const name = (values.store_name ?? "").trim() || orgName;
  const description = (values.store_description ?? "").trim();

  return {
    platformEnabled: parseStoreBoolean(values.store_platform_enabled, true),
    enabled: parseStoreBoolean(values.store_enabled, false),
    slug,
    whatsapp,
    name,
    description,
    publicUrl: slug ? `/store/${slug}` : null,
  };
}

export async function getWebsiteConfig(orgId: number): Promise<WebsiteConfig | null> {
  const [organization, rows] = await Promise.all([
    db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .get(),
    db.select().from(settingsTable).where(eq(settingsTable.orgId, orgId)),
  ]);

  if (!organization) return null;
  return resolveWebsiteConfig(rows, organization.name);
}

export async function assertStoreSlugAvailable(slug: string, orgId: number): Promise<boolean> {
  const existing = await db
    .select({ orgId: settingsTable.orgId })
    .from(settingsTable)
    .where(and(eq(settingsTable.key, STORE_SLUG_KEY), eq(settingsTable.value, slug)))
    .get();

  return !existing || existing.orgId === orgId;
}

export function upsertSetting(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: number,
  key: string,
  value: string,
): void {
  tx.insert(settingsTable)
    .values({ orgId, key, value })
    .onConflictDoUpdate({
      target: [settingsTable.orgId, settingsTable.key],
      set: { value },
    })
    .run();
}

export async function collectPublicProducts(orgId: number): Promise<PublicStoreProduct[]> {
  const rows = await db
    .select({
      id: productsTable.id,
      name: productsTable.name,
      service: productsTable.service,
      price: productsTable.defaultPrice,
      durationDays: productsTable.defaultDurationDays,
      createdAt: productsTable.createdAt,
      freeSlotCount: sql<number>`
        coalesce(sum(case
          when ${slotsTable.status} = 'free'
            and ${accountsTable.status} = 'active'
            and date(${accountsTable.expiryDate}) >= date('now')
          then 1 else 0 end), 0)
      `,
    })
    .from(productsTable)
    .leftJoin(
      accountsTable,
      and(
        eq(accountsTable.productId, productsTable.id),
        eq(accountsTable.orgId, orgId),
      ),
    )
    .leftJoin(slotsTable, eq(slotsTable.accountId, accountsTable.id))
    .where(eq(productsTable.orgId, orgId))
    .groupBy(productsTable.id)
    .orderBy(asc(productsTable.createdAt), asc(productsTable.id));

  return rows
    .map((row, sortOrder) => {
      const freeSlotCount = Number(row.freeSlotCount ?? 0);
      return {
        id: row.id,
        name: row.name,
        service: row.service,
        price: row.price,
        durationDays: row.durationDays,
        freeSlotCount,
        available: freeSlotCount > 0,
        sortOrder,
      };
    })
    .sort((a, b) => {
      if (a.available !== b.available) return a.available ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    })
    .map(({ sortOrder: _sortOrder, ...product }) => product);
}

export async function getPublicStoreBySlug(slug: string): Promise<PublicStorePayload | null> {
  const slugRow = await db
    .select({ orgId: settingsTable.orgId })
    .from(settingsTable)
    .where(and(eq(settingsTable.key, STORE_SLUG_KEY), eq(settingsTable.value, slug)))
    .get();

  if (!slugRow) return null;

  const [organization, rows, currencyRow] = await Promise.all([
    db
      .select({ id: organizationsTable.id, name: organizationsTable.name, status: organizationsTable.status })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, slugRow.orgId))
      .get(),
    db.select().from(settingsTable).where(eq(settingsTable.orgId, slugRow.orgId)),
    db
      .select({ value: settingsTable.value })
      .from(settingsTable)
      .where(and(eq(settingsTable.orgId, slugRow.orgId), eq(settingsTable.key, "currency")))
      .get(),
  ]);

  if (!organization || organization.status !== "active") return null;

  const config = resolveWebsiteConfig(rows, organization.name);
  if (!config.platformEnabled || !config.enabled || config.slug !== slug || !isValidWhatsapp(config.whatsapp)) {
    return null;
  }

  return {
    name: config.name,
    description: config.description,
    whatsappNumber: config.whatsapp,
    currency: currencyRow?.value ?? "د.ب",
    products: await collectPublicProducts(organization.id),
  };
}
```

- [ ] **Step 2: Typecheck API server**

Run:

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 3: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 3: Add Public Store and Org Website API Routes

**Files:**
- Create: `artifacts/api-server/src/routes/store.ts`
- Create: `artifacts/api-server/src/routes/website.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Create the public store route**

Create `artifacts/api-server/src/routes/store.ts`:

```ts
import { Router, type IRouter } from "express";
import { storeSlugParamsSchema } from "@workspace/db";
import { getPublicStoreBySlug } from "../lib/store-settings";

const router: IRouter = Router();

router.get("/store/:slug", async (req, res): Promise<void> => {
  const params = storeSlugParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(404).json({ error: "المتجر غير موجود" });
    return;
  }

  const store = await getPublicStoreBySlug(params.data.slug);
  if (!store) {
    res.status(404).json({ error: "المتجر غير موجود" });
    return;
  }

  res.json(store);
});

export default router;
```

- [ ] **Step 2: Create the org-admin website route**

Create `artifacts/api-server/src/routes/website.ts`:

```ts
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
```

If TypeScript reports `settingsTable` or `eq` is unused, remove those imports.

- [ ] **Step 3: Register the new routers**

In `artifacts/api-server/src/routes/index.ts`, add imports:

```ts
import storeRouter from "./store";
import websiteRouter from "./website";
```

Then register them before `platformRouter`:

```ts
router.use(storeRouter);
router.use(websiteRouter);
router.use(platformRouter);
```

The surrounding block should include these routers:

```ts
router.use(reportsRouter);
router.use(storeRouter);
router.use(websiteRouter);
router.use(platformRouter);
router.use(backupRouter);
```

- [ ] **Step 4: Typecheck API server**

Run:

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 5: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 4: Add Platform Website Access API

**Files:**
- Modify: `artifacts/api-server/src/routes/platform.ts`

- [ ] **Step 1: Add imports**

In `artifacts/api-server/src/routes/platform.ts`, extend the `@workspace/db` import with:

```ts
platformWebsiteUpdateSchema,
```

Add helper imports:

```ts
import {
  parseStoreBoolean,
  STORE_PLATFORM_ENABLED_KEY,
  upsertSetting,
} from "../lib/store-settings";
```

- [ ] **Step 2: Add platform website routes before the delete-org route**

Insert this block after:

```ts
router.post("/platform/orgs/:id/unsuspend", orgStatusHandler("active", "platform_unsuspend_org"));
```

and before:

```ts
router.post("/platform/orgs/:id/reset-owner-password", async (req: Request, res: Response): Promise<void> => {
```

```ts
router.get("/platform/websites", async (_req: Request, res: Response): Promise<void> => {
  const [organizations, settings] = await Promise.all([
    db
      .select({
        id: organizationsTable.id,
        name: organizationsTable.name,
        status: organizationsTable.status,
      })
      .from(organizationsTable)
      .orderBy(asc(organizationsTable.createdAt)),
    db
      .select({ orgId: settingsTable.orgId, value: settingsTable.value })
      .from(settingsTable)
      .where(eq(settingsTable.key, STORE_PLATFORM_ENABLED_KEY)),
  ]);

  const settingByOrg = new Map(settings.map((row) => [row.orgId, row.value]));
  res.json(organizations.map((organization) => ({
    orgId: organization.id,
    orgName: organization.name,
    orgStatus: organization.status,
    platformEnabled: parseStoreBoolean(settingByOrg.get(organization.id), true),
  })));
});

router.patch("/platform/websites/:id", async (req: Request, res: Response): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }

  const parsed = platformWebsiteUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }

  const actor = getRequestUser(req);
  const orgId = params.data.id;
  const updated = db.transaction((tx) => {
    const organization = tx
      .select({ id: organizationsTable.id, name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .get();
    if (!organization) return null;

    upsertSetting(tx, orgId, STORE_PLATFORM_ENABLED_KEY, String(parsed.data.platformEnabled));
    tx.insert(auditLogTable).values({
      userId: actor.id,
      orgId: null,
      action: "platform_website_access_update",
      entity: "organization",
      entityId: orgId,
      detail: `${parsed.data.platformEnabled ? "تفعيل" : "تعطيل"} ميزة الموقع للنشاط: ${organization.name}`,
    }).run();

    return organization.id;
  });

  if (!updated) {
    res.status(404).json({ error: "النشاط غير موجود" });
    return;
  }

  res.json({ ok: true });
});
```

- [ ] **Step 3: Typecheck API server**

Run:

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 4: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 5: Update OpenAPI Contract and Regenerate Clients

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Regenerate: `lib/api-client-react/src/generated/*`
- Regenerate: `lib/api-zod/src/generated/*`

- [ ] **Step 1: Add API tags**

In `lib/api-spec/openapi.yaml`, add these tags after the existing `settings` tag:

```yaml
  - name: website
    description: Organization website settings
  - name: store
    description: Public store operations
```

- [ ] **Step 2: Add paths**

Add these path definitions before `/settings`:

```yaml
  /store/{slug}:
    get:
      operationId: getPublicStore
      tags: [store]
      summary: Get a public store by slug
      parameters:
        - name: slug
          in: path
          required: true
          schema:
            type: string
            minLength: 3
            maxLength: 64
            pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
      responses:
        "200":
          description: Public store
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PublicStore"
        "404":
          description: Store not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /website:
    get:
      operationId: getWebsiteSettings
      tags: [website]
      summary: Get organization website settings (admin only)
      responses:
        "200":
          description: Website settings
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WebsiteSettings"
    patch:
      operationId: updateWebsiteSettings
      tags: [website]
      summary: Update organization website settings (admin only)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/WebsiteUpdate"
      responses:
        "200":
          description: Updated website settings
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/WebsiteSettings"
        "400":
          description: Invalid input or missing required live settings
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "403":
          description: Website feature unavailable
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "409":
          description: Slug already used
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"

  /platform/websites:
    get:
      operationId: listPlatformWebsites
      tags: [platform]
      summary: List platform website access states
      responses:
        "200":
          description: Website access states
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/PlatformWebsiteOrg"

  /platform/websites/{id}:
    patch:
      operationId: updatePlatformWebsite
      tags: [platform]
      summary: Update platform website access for an organization
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/PlatformWebsiteUpdate"
      responses:
        "200":
          description: Updated
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessResponse"
        "404":
          description: Organization not found
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

- [ ] **Step 3: Add schemas**

Add these schemas near the existing `Settings` schema:

```yaml
    PublicStoreProduct:
      type: object
      required: [id, name, service, price, durationDays, freeSlotCount, available]
      properties:
        id:
          type: integer
        name:
          type: string
        service:
          type: string
        price:
          type: number
        durationDays:
          type: integer
        freeSlotCount:
          type: integer
        available:
          type: boolean

    PublicStore:
      type: object
      required: [name, description, whatsappNumber, currency, products]
      properties:
        name:
          type: string
        description:
          type: string
        whatsappNumber:
          type: string
        currency:
          type: string
        products:
          type: array
          items:
            $ref: "#/components/schemas/PublicStoreProduct"

    WebsiteSettings:
      type: object
      required: [platformEnabled, enabled, slug, whatsapp, name, description, publicUrl]
      properties:
        platformEnabled:
          type: boolean
        enabled:
          type: boolean
        slug:
          type: string
        whatsapp:
          type: string
        name:
          type: string
        description:
          type: string
        publicUrl:
          type: ["string", "null"]

    WebsiteUpdate:
      type: object
      minProperties: 1
      properties:
        enabled:
          type: boolean
        slug:
          type: string
          minLength: 3
          maxLength: 64
          pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
        whatsapp:
          type: string
        name:
          type: string
          maxLength: 120
        description:
          type: string
          maxLength: 300

    PlatformWebsiteOrg:
      type: object
      required: [orgId, orgName, orgStatus, platformEnabled]
      properties:
        orgId:
          type: integer
        orgName:
          type: string
        orgStatus:
          type: string
          enum: [active, suspended]
        platformEnabled:
          type: boolean

    PlatformWebsiteUpdate:
      type: object
      required: [platformEnabled]
      properties:
        platformEnabled:
          type: boolean
```

- [ ] **Step 4: Run code generation**

Run:

```bash
pnpm --filter @workspace/api-spec run codegen
```

Expected: Orval regenerates API client/Zod files and `pnpm -w run typecheck:libs` passes.

- [ ] **Step 5: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 6: Add Frontend API Helpers

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/phase3-api.ts`

- [ ] **Step 1: Add types near the existing `PlatformOrg` type**

Add:

```ts
export type PublicStoreProduct = {
  id: number;
  name: string;
  service: string;
  price: number;
  durationDays: number;
  freeSlotCount: number;
  available: boolean;
};

export type PublicStore = {
  name: string;
  description: string;
  whatsappNumber: string;
  currency: string;
  products: PublicStoreProduct[];
};

export type WebsiteSettings = {
  platformEnabled: boolean;
  enabled: boolean;
  slug: string;
  whatsapp: string;
  name: string;
  description: string;
  publicUrl: string | null;
};

export type WebsiteUpdate = Partial<Pick<WebsiteSettings, "enabled" | "slug" | "whatsapp" | "name" | "description">>;

export type PlatformWebsiteOrg = {
  orgId: number;
  orgName: string;
  orgStatus: "active" | "suspended";
  platformEnabled: boolean;
};
```

- [ ] **Step 2: Add hooks after platform org hooks**

Add:

```ts
export const useGetPublicStore = (slug: string) => useQuery({
  queryKey: ["store", slug],
  queryFn: () => request<PublicStore>(`/api/store/${encodeURIComponent(slug)}`),
  retry: false,
});

export const useGetWebsiteSettings = () => useQuery({
  queryKey: ["website"],
  queryFn: () => request<WebsiteSettings>("/api/website"),
});

export const useUpdateWebsiteSettings = () => useMutation({
  mutationFn: (data: WebsiteUpdate) => request<WebsiteSettings>("/api/website", {
    method: "PATCH",
    body: JSON.stringify(data),
  }),
});

export const usePlatformWebsites = () => useQuery({
  queryKey: ["platform", "websites"],
  queryFn: () => request<PlatformWebsiteOrg[]>("/api/platform/websites"),
});

export const useUpdatePlatformWebsite = () => useMutation({
  mutationFn: ({ orgId, platformEnabled }: { orgId: number; platformEnabled: boolean }) =>
    request<{ ok: true }>(`/api/platform/websites/${orgId}`, {
      method: "PATCH",
      body: JSON.stringify({ platformEnabled }),
    }),
});
```

- [ ] **Step 3: Typecheck frontend**

Run:

```bash
pnpm --filter @workspace/accounts-manager run typecheck
```

Expected: PASS.

- [ ] **Step 4: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 7: Add Frontend Strings

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`

- [ ] **Step 1: Add `website` and `store` string groups**

Inside the exported `strings` object, add these top-level groups before `dataSecurity`:

```ts
  website: {
    nav: "الموقع الإلكتروني",
    title: "الموقع الإلكتروني",
    hint: "اضبط صفحة المتجر العامة التي يراها العملاء قبل التواصل عبر واتساب.",
    lockedTitle: "ميزة الموقع غير متاحة حالياً",
    lockedDescription: "تم إيقاف إمكانية استخدام الموقع لهذا النشاط من إدارة المنصة. تواصل مع مالك المنصة لإعادة التفعيل.",
    live: "الموقع مفعل",
    offline: "الموقع غير مفعل",
    slug: "رابط المتجر",
    slugHint: "أحرف إنجليزية صغيرة وأرقام وشرطات فقط",
    whatsapp: "رقم واتساب المتجر",
    whatsappHint: "اكتب الرقم بصيغة دولية مثل 96279XXXXXXX",
    name: "اسم المتجر",
    description: "وصف قصير",
    publicLink: "رابط المتجر",
    save: "حفظ إعدادات الموقع",
    saved: "تم حفظ إعدادات الموقع",
    saveError: "تعذر حفظ إعدادات الموقع",
    duplicateSlug: "رابط المتجر مستخدم من نشاط آخر",
    platformWebsites: "مواقع الأنشطة",
    platformHint: "تحكم بإتاحة ميزة الموقع الإلكتروني لكل نشاط.",
    accessAllowed: "مسموح",
    accessBlocked: "موقوف",
    updateAccessError: "تعذر تحديث إتاحة الموقع",
  },
  store: {
    loading: "جاري تحميل المتجر...",
    notFound: "المتجر غير موجود",
    available: "متوفر",
    unavailable: "غير متوفر حالياً",
    orderNow: "اطلب الآن",
    askAvailability: "اسأل عن التوفر",
    durationDays: (days: number) => `${days} يوم`,
    orderMessage: (product: string, price: string, duration: number) => `مرحباً، أريد الاشتراك في ${product} بسعر ${price} لمدة ${duration} يوم.`,
    availabilityMessage: (product: string) => `مرحباً، أريد الاستفسار عن توفر ${product}.`,
  },
```

- [ ] **Step 2: Typecheck frontend**

Run:

```bash
pnpm --filter @workspace/accounts-manager run typecheck
```

Expected: PASS.

- [ ] **Step 3: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 8: Build the Public Store Page

**Files:**
- Create: `artifacts/accounts-manager/src/pages/store.tsx`
- Modify: `artifacts/accounts-manager/src/App.tsx`

- [ ] **Step 1: Create `store.tsx`**

Create `artifacts/accounts-manager/src/pages/store.tsx`:

```tsx
import { useEffect } from "react";
import { MessageCircle, Package, Loader2 } from "lucide-react";
import { useGetPublicStore, type PublicStoreProduct } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function whatsappUrl(number: string, message: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

function ProductCard({
  product,
  whatsappNumber,
  currency,
}: {
  product: PublicStoreProduct;
  whatsappNumber: string;
  currency: string;
}) {
  const price = `${product.price} ${currency}`;
  const message = product.available
    ? strings.store.orderMessage(product.name, price, product.durationDays)
    : strings.store.availabilityMessage(product.name);

  return (
    <Card className="h-full">
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg leading-7">{product.name}</CardTitle>
            <p className="text-sm text-muted-foreground">{product.service}</p>
          </div>
          <Badge variant={product.available ? "default" : "secondary"}>
            {product.available ? strings.store.available : strings.store.unavailable}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md bg-muted px-3 py-2 text-sm">
          <span>{price}</span>
          <span>{strings.store.durationDays(product.durationDays)}</span>
        </div>
        <Button asChild className="w-full min-h-11" variant={product.available ? "default" : "outline"}>
          <a href={whatsappUrl(whatsappNumber, message)} target="_blank" rel="noopener noreferrer">
            <MessageCircle className="me-2 h-4 w-4" />
            {product.available ? strings.store.orderNow : strings.store.askAvailability}
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function StorePage({ slug }: { slug: string }) {
  const { data, isLoading, isError } = useGetPublicStore(slug);

  useEffect(() => {
    if (!data) return;
    document.title = data.name;
    const description = data.description || strings.app.description;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "description";
      document.head.appendChild(meta);
    }
    meta.content = description;
  }, [data]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background px-4 py-10" dir="rtl">
        <div className="mx-auto flex max-w-5xl items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="me-2 h-5 w-5 animate-spin" />
          {strings.store.loading}
        </div>
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="min-h-screen bg-background px-4 py-10" dir="rtl">
        <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-lg border bg-card p-8 text-center">
          <Package className="h-10 w-10 text-muted-foreground" />
          <h1 className="text-xl font-bold">{strings.store.notFound}</h1>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="space-y-3 border-b pb-6">
          <h1 className="text-3xl font-bold tracking-normal">{data.name}</h1>
          {data.description ? (
            <p className="max-w-2xl text-sm leading-7 text-muted-foreground">{data.description}</p>
          ) : null}
        </header>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              whatsappNumber={data.whatsappNumber}
              currency={data.currency}
            />
          ))}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Register the public route**

In `artifacts/accounts-manager/src/App.tsx`, add:

```ts
import StorePage from "@/pages/store";
```

Inside `<Switch>`, add the route after `/about` and before `/`:

```tsx
      <Route path="/store/:slug">
        {(params) => <StorePage slug={params.slug} />}
      </Route>
```

- [ ] **Step 3: Typecheck frontend**

Run:

```bash
pnpm --filter @workspace/accounts-manager run typecheck
```

Expected: PASS.

- [ ] **Step 4: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 9: Build Org Admin Website Page

**Files:**
- Create: `artifacts/accounts-manager/src/pages/website.tsx`
- Modify: `artifacts/accounts-manager/src/App.tsx`
- Modify: `artifacts/accounts-manager/src/components/layout.tsx`

- [ ] **Step 1: Create org admin Website page**

Create `artifacts/accounts-manager/src/pages/website.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2, Lock } from "lucide-react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useGetWebsiteSettings, useUpdateWebsiteSettings, type WebsiteSettings } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const emptyForm: WebsiteSettings = {
  platformEnabled: true,
  enabled: false,
  slug: "",
  whatsapp: "",
  name: "",
  description: "",
  publicUrl: null,
};

function publicUrl(slug: string): string {
  return slug ? `${window.location.origin}/store/${slug}` : "";
}

export default function WebsitePage() {
  const { data, isLoading } = useGetWebsiteSettings();
  const update = useUpdateWebsiteSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<WebsiteSettings>(emptyForm);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = () => {
    update.mutate({
      enabled: form.enabled,
      slug: form.slug,
      whatsapp: form.whatsapp,
      name: form.name,
      description: form.description,
    }, {
      onSuccess: (next) => {
        setForm(next);
        queryClient.invalidateQueries({ queryKey: ["website"] });
        toast({ title: strings.website.saved });
      },
      onError: (error) => {
        const message = error instanceof Error && error.message.includes("مستخدم")
          ? strings.website.duplicateSlug
          : strings.website.saveError;
        toast({ title: message, variant: "destructive" });
      },
    });
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!form.platformEnabled) {
    return (
      <Layout>
        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {strings.website.lockedTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-7 text-muted-foreground">{strings.website.lockedDescription}</p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-5 w-5" />
            {strings.website.title}
          </CardTitle>
          <p className="text-sm text-muted-foreground">{strings.website.hint}</p>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="flex items-center justify-between rounded-md border p-4">
            <div>
              <Label>{form.enabled ? strings.website.live : strings.website.offline}</Label>
            </div>
            <Switch checked={form.enabled} onCheckedChange={(enabled) => setForm({ ...form, enabled })} />
          </div>

          <Field label={strings.website.slug} hint={strings.website.slugHint}>
            <Input
              value={form.slug}
              dir="ltr"
              onChange={(event) => setForm({ ...form, slug: event.target.value.trim().toLowerCase() })}
              placeholder="ahmad-subs"
            />
          </Field>

          {form.slug ? (
            <div className="rounded-md bg-muted px-3 py-2 text-sm" dir="ltr">
              {publicUrl(form.slug)}
            </div>
          ) : null}

          <Field label={strings.website.whatsapp} hint={strings.website.whatsappHint}>
            <Input
              value={form.whatsapp}
              dir="ltr"
              onChange={(event) => setForm({ ...form, whatsapp: event.target.value })}
              placeholder="96279XXXXXXX"
            />
          </Field>

          <Field label={strings.website.name}>
            <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>

          <Field label={strings.website.description}>
            <Textarea
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              rows={4}
            />
          </Field>

          <Button className="min-h-11" onClick={save} disabled={update.isPending}>
            {update.isPending ? <Loader2 className="me-2 h-4 w-4 animate-spin" /> : null}
            {strings.website.save}
          </Button>
        </CardContent>
      </Card>
    </Layout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
```

- [ ] **Step 2: Register the org admin route**

In `artifacts/accounts-manager/src/App.tsx`, add:

```ts
import WebsitePage from "@/pages/website";
```

Add this route after `/admin/settings`:

```tsx
      <Route path="/admin/website"><AuthGuard><OrgGuard><AdminGuard><WebsitePage /></AdminGuard></OrgGuard></AuthGuard></Route>
```

- [ ] **Step 3: Add Website nav item**

In `artifacts/accounts-manager/src/components/layout.tsx`, add `Globe2` to the `lucide-react` import.

In the admin nav array, add this item before settings:

```ts
      { href: "/admin/website", label: strings.website.nav, icon: Globe2 },
```

The admin block should include:

```ts
    ...(user?.role === "admin" ? [
      { href: "/admin/website", label: strings.website.nav, icon: Globe2 },
      { href: "/admin/settings", label: strings.phase3.settings, icon: Settings },
      { href: "/admin/users", label: strings.phase3.users, icon: ShieldCheck },
      { href: "/admin/audit", label: strings.phase3.audit, icon: ReceiptText },
      { href: "/admin/data-security", label: strings.dataSecurity.nav, icon: DatabaseBackup },
    ] : []),
```

- [ ] **Step 4: Typecheck frontend**

Run:

```bash
pnpm --filter @workspace/accounts-manager run typecheck
```

Expected: PASS.

- [ ] **Step 5: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 10: Build Platform Websites Page

**Files:**
- Create: `artifacts/accounts-manager/src/pages/platform-websites.tsx`
- Modify: `artifacts/accounts-manager/src/App.tsx`
- Modify: `artifacts/accounts-manager/src/components/layout.tsx`

- [ ] **Step 1: Create platform Websites page**

Create `artifacts/accounts-manager/src/pages/platform-websites.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { Globe2, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { usePlatformWebsites, useUpdatePlatformWebsite } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

export default function PlatformWebsitesPage() {
  const { data = [], isLoading } = usePlatformWebsites();
  const update = useUpdatePlatformWebsite();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const setAccess = (orgId: number, platformEnabled: boolean) => {
    update.mutate({ orgId, platformEnabled }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platform", "websites"] }),
      onError: () => toast({ title: strings.website.updateAccessError, variant: "destructive" }),
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <h1 className="text-2xl font-bold">{strings.website.platformWebsites}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{strings.website.platformHint}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe2 className="h-5 w-5" />
            {strings.website.platformWebsites}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النشاط</TableHead>
                <TableHead>حالة النشاط</TableHead>
                <TableHead>إتاحة الموقع</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((org) => (
                <TableRow key={org.orgId}>
                  <TableCell>
                    <div className="font-medium">{org.orgName}</div>
                    <div className="text-xs text-muted-foreground">#{org.orgId}</div>
                  </TableCell>
                  <TableCell>{org.orgStatus === "active" ? "نشط" : "معلق"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={org.platformEnabled}
                        disabled={update.isPending}
                        onCheckedChange={(checked) => setAccess(org.orgId, checked)}
                      />
                      <span className="text-sm text-muted-foreground">
                        {org.platformEnabled ? strings.website.accessAllowed : strings.website.accessBlocked}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `artifacts/accounts-manager/src/App.tsx`, add:

```ts
import PlatformWebsitesPage from "@/pages/platform-websites";
```

Add this route after `/platform`:

```tsx
      <Route path="/platform/websites"><AuthGuard><SuperadminGuard><PlatformWebsitesPage /></SuperadminGuard></AuthGuard></Route>
```

- [ ] **Step 3: Add platform nav item**

In `artifacts/accounts-manager/src/components/layout.tsx`, in the superadmin nav array, add:

```ts
    { href: "/platform/websites", label: strings.website.platformWebsites, icon: Globe2 },
```

The superadmin nav array should be:

```ts
  const navItems = user?.role === "superadmin" ? [
    { href: "/platform", label: "إدارة المنصة", icon: ShieldCheck },
    { href: "/platform/websites", label: strings.website.platformWebsites, icon: Globe2 },
  ] : [
```

- [ ] **Step 4: Typecheck frontend**

Run:

```bash
pnpm --filter @workspace/accounts-manager run typecheck
```

Expected: PASS.

- [ ] **Step 5: User-managed checkpoint**

Stop and let the user handle git state if they want a checkpoint. Do not run git.

---

### Task 11: Full Verification

**Files:** none.

- [ ] **Step 1: Run API server typecheck**

Run:

```bash
pnpm --filter @workspace/api-server run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run frontend typecheck**

Run:

```bash
pnpm --filter @workspace/accounts-manager run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run workspace typecheck**

Run:

```bash
pnpm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run production build**

Run:

```bash
pnpm run build
```

Expected: PASS.

- [ ] **Step 5: Manual smoke checklist for the user**

These checks are not required commands in this plan, but the final implementer should report whether they were skipped or completed:

- Superadmin can open `/platform/websites`.
- Superadmin can disable website access for an org.
- Org admin sees a locked Website page when platform access is disabled.
- Org admin can save slug, WhatsApp, store name, and description when platform access is enabled.
- Org admin cannot enable the store without a valid slug and WhatsApp number.
- Duplicate slug returns a visible error.
- `/store/:slug` returns public product data only when org is active, platform access is enabled, org store is enabled, slug is valid, and WhatsApp is valid.
- Available products appear before unavailable products.
- Available product CTA and unavailable product CTA produce different WhatsApp messages.

- [ ] **Step 6: User-managed final checkpoint**

Stop and let the user handle git state. Do not run git.

---

## Self-Review Notes

- Spec coverage: platform access, org live state, slug uniqueness, WhatsApp-only CTA, fixed messages, product availability ordering, public 404 behavior, OpenAPI, and typecheck/build verification are covered.
- No automated tests are included because the user chose no tests.
- No git commands are included because the user explicitly handles git.
- The plan uses the existing `settings` table and avoids migrations.
- The riskiest implementation points are `store_slug` uniqueness and public visibility checks. Those are centralized in `store-settings.ts` so review is focused.
