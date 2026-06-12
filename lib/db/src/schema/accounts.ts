import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { productsTable } from "./products";
import { organizationsTable } from "./organizations";

export const accountsTable = sqliteTable("accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
  productId: integer("product_id").notNull().references(() => productsTable.id),
  label: text("label").notNull(),
  email: text("email").notNull(),
  passwordEncrypted: text("password_encrypted").notNull(),
  capacity: integer("capacity").notNull().default(1),
  status: text("status", { enum: ["active", "disabled", "needs_attention"] }).notNull().default("active"),
  startDate: text("start_date").notNull().default(sql`(date('now'))`),
  expiryDate: text("expiry_date").notNull().default(sql`(date('now', '+30 days'))`),
  notes: text("notes"),
  createdAt: text("created_at").notNull().default(sql`(datetime('now'))`),
});

export const insertAccountSchema = createInsertSchema(accountsTable).omit({ id: true, createdAt: true });
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type Account = typeof accountsTable.$inferSelect;
