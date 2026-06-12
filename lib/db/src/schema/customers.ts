import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { sql } from "drizzle-orm";
import { organizationsTable } from "./organizations";

export const customersTable = sqliteTable(
  "customers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    whatsapp: text("whatsapp"),
    email: text("email"),
    notes: text("notes"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (table) => [
    uniqueIndex("customers_org_id_phone_unique").on(table.orgId, table.phone),
    index("customers_name_idx").on(table.name),
    index("customers_phone_idx").on(table.phone),
  ],
);

export const insertCustomerSchema = createInsertSchema(customersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCustomer = z.infer<typeof insertCustomerSchema>;
export type Customer = typeof customersTable.$inferSelect;
