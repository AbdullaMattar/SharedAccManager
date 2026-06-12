import {
  accountsTable,
  customersTable,
  db,
  productsTable,
  slotsTable,
  subscriptionsTable,
} from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { computedSubscriptionStatus } from "./subscription-status";

export const subscriptionSummary = {
  id: subscriptionsTable.id,
  customerId: customersTable.id,
  customerName: customersTable.name,
  customerPhone: customersTable.phone,
  customerWhatsapp: customersTable.whatsapp,
  slotId: slotsTable.id,
  slotIndex: slotsTable.slotIndex,
  accountId: accountsTable.id,
  accountLabel: accountsTable.label,
  productId: productsTable.id,
  productName: productsTable.name,
  productDefaultDurationDays: productsTable.defaultDurationDays,
  startDate: accountsTable.startDate,
  expiryDate: accountsTable.expiryDate,
  price: subscriptionsTable.price,
  status: computedSubscriptionStatus,
  notes: subscriptionsTable.notes,
  createdAt: subscriptionsTable.createdAt,
};

export function baseSubscriptionQuery(orgId: number, ...conditions: Array<SQL | undefined>) {
  return db
    .select(subscriptionSummary)
    .from(subscriptionsTable)
    .innerJoin(customersTable, eq(subscriptionsTable.customerId, customersTable.id))
    .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
    .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
    .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
    .where(and(eq(subscriptionsTable.orgId, orgId), ...conditions));
}

export const hasNoLaterSubscription = sql`
  not exists (
    select 1 from subscriptions newer
    where newer.slot_id = ${subscriptionsTable.slotId}
      and newer.id > ${subscriptionsTable.id}
  )
`;
