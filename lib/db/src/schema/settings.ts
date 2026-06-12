import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { organizationsTable } from "./organizations";

export const settingsTable = sqliteTable("settings", {
  orgId: integer("org_id").notNull().default(1).references(() => organizationsTable.id),
  key: text("key").notNull(),
  value: text("value").notNull(),
}, (table) => [
  primaryKey({ columns: [table.orgId, table.key] }),
]);
