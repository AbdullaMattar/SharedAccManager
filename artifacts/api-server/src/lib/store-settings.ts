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
