import { Router, type IRouter } from "express";
import { db, expiringQuerySchema, subscriptionsTable, validationError } from "@workspace/db";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { getSettings } from "../lib/settings";
import { baseSubscriptionQuery } from "../lib/subscription-query";

const router: IRouter = Router();

router.get("/expiring", requireAuth, async (req, res): Promise<void> => {
  const parsed = expiringQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: validationError(parsed.error) });
    return;
  }
  const settings = await getSettings();
  const days = parsed.data.days ?? settings.reminderLeadDays;
  const subscriptions = await baseSubscriptionQuery()
    .where(and(
      eq(subscriptionsTable.status, "active"),
      gte(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now')`),
      lte(sql`date(${subscriptionsTable.expiryDate})`, sql`date('now', ${`+${days} days`})`),
    ))
    .orderBy(asc(subscriptionsTable.expiryDate));
  res.json({ days, reminderRecipient: settings.reminderRecipient, subscriptions });
});

export default router;
