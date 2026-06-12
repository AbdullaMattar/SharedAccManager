import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { subscriptionsTable } from "./subscriptions";
import { usersTable } from "./users";
import { organizationsTable } from "./organizations";

export const paymentsTable = sqliteTable("payments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
  subscriptionId: integer("subscription_id").notNull().references(() => subscriptionsTable.id),
  amount: real("amount").notNull(),
  method: text("method", { enum: ["cash", "transfer", "other"] }).notNull().default("cash"),
  paidAt: text("paid_at").notNull().default(sql`(datetime('now'))`),
  loggedBy: integer("logged_by").references(() => usersTable.id),
  notes: text("notes"),
});

export const insertPaymentSchema = createInsertSchema(paymentsTable).omit({ id: true });
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Payment = typeof paymentsTable.$inferSelect;
