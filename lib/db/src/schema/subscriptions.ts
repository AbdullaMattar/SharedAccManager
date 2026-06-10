import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { slotsTable } from "./slots";
import { customersTable } from "./customers";

export const subscriptionsTable = sqliteTable("subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slotId: integer("slot_id").notNull().references(() => slotsTable.id),
  customerId: integer("customer_id").notNull().references(() => customersTable.id),
  startDate: text("start_date").notNull(),
  expiryDate: text("expiry_date").notNull(),
  price: real("price").notNull().default(0),
  status: text("status", { enum: ["active", "expired", "cancelled"] }).notNull().default("active"),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
