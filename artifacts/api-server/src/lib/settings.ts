import { db, settingsTable } from "@workspace/db";
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

export async function getSettings(orgId: number): Promise<Settings> {
  const rows = await db.select().from(settingsTable).where(eq(settingsTable.orgId, orgId));
  const values: Record<keyof typeof DEFAULT_SETTINGS, string> = {
    ...DEFAULT_SETTINGS,
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
