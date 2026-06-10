import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { accountsTable } from "./accounts";

export const slotsTable = sqliteTable("slots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
  slotIndex: integer("slot_index").notNull(),
  status: text("status", { enum: ["free", "occupied", "disabled"] }).notNull().default("free"),
});

export const insertSlotSchema = createInsertSchema(slotsTable).omit({ id: true });
export type InsertSlot = z.infer<typeof insertSlotSchema>;
export type Slot = typeof slotsTable.$inferSelect;
