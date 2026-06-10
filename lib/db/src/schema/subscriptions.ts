import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { slotsTable } from "./slots";
import { customersTable } from "./customers";

export const subscriptionsTable = sqliteTable(
  "subscriptions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => slotsTable.id),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customersTable.id),
    startDate: text("start_date").notNull(),
    expiryDate: text("expiry_date").notNull(),
    price: real("price").notNull().default(0),
    status: text("status", { enum: ["active", "expired", "cancelled"] })
      .notNull()
      .default("active"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    index("subscriptions_customer_idx").on(table.customerId),
    index("subscriptions_slot_idx").on(table.slotId),
    index("subscriptions_status_idx").on(table.status),
    uniqueIndex("subscriptions_one_active_per_slot_idx")
      .on(table.slotId)
      .where(sql`${table.status} = 'active'`),
  ],
);

export const insertSubscriptionSchema = createInsertSchema(
  subscriptionsTable,
).omit({ id: true, createdAt: true });
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
