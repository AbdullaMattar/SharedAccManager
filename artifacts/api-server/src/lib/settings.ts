import { db, organizationsTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export const DEFAULT_SETTINGS = {
  reminder_lead_days: "3",
  reminder_recipient: "staff",
  grace_days: "3",
  business_name: "مدير الحسابات المشتركة",
  currency: "د.ب",
} as const;

export type Settings = {
  reminderLeadDays: number;
  reminderRecipient: "staff" | "customer" | "both";
  graceDays: number;
  businessName: string;
  currency: string;
};

type SettingEntry = Pick<typeof settingsTable.$inferSelect, "key" | "value">;

export function resolveSettings(rows: SettingEntry[], orgName?: string | null): Settings {
  const values: Record<keyof typeof DEFAULT_SETTINGS, string> = {
    ...DEFAULT_SETTINGS,
    business_name: orgName?.trim() || DEFAULT_SETTINGS.business_name,
  };
  for (const row of rows) {
    if (row.key in values) {
      values[row.key as keyof typeof values] = row.value;
    }
  }
  return {
    reminderLeadDays: Number(values.reminder_lead_days),
    reminderRecipient: values.reminder_recipient as Settings["reminderRecipient"],
    graceDays: Number(values.grace_days),
    businessName: values.business_name,
    currency: values.currency,
  };
}

export async function getSettings(orgId: number): Promise<Settings> {
  const [rows, organization] = await Promise.all([
    db.select().from(settingsTable).where(eq(settingsTable.orgId, orgId)),
    db
      .select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .get(),
  ]);
  return resolveSettings(rows, organization?.name);
}
