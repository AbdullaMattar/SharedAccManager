import { subscriptionsTable } from "@workspace/db";
import { and, eq, gt, lte, or, sql, type SQL } from "drizzle-orm";

export type SubscriptionStatus = "active" | "expired" | "cancelled";

export const computedSubscriptionStatus = sql<SubscriptionStatus>`
  case
    when ${subscriptionsTable.status} = 'active'
      and date(${subscriptionsTable.expiryDate}) < date('now')
    then 'expired'
    else ${subscriptionsTable.status}
  end
`;

export function statusCondition(status: SubscriptionStatus): SQL {
  if (status === "active") {
    return and(
      eq(subscriptionsTable.status, "active"),
      gt(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now', '-1 day')`),
    )!;
  }
  if (status === "expired") {
    return or(
      eq(subscriptionsTable.status, "expired"),
      and(
        eq(subscriptionsTable.status, "active"),
        lte(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now', '-1 day')`),
      ),
    )!;
  }
  return eq(subscriptionsTable.status, "cancelled");
}

export function effectiveStatus(subscription: {
  status: SubscriptionStatus;
  expiryDate: string;
}): SubscriptionStatus {
  return subscription.status === "active" &&
    subscription.expiryDate < new Date().toISOString().slice(0, 10)
    ? "expired"
    : subscription.status;
}
