import { Router, type IRouter } from "express";
import { accountsTable, db, paymentsTable, productsTable, slotsTable, subscriptionsTable } from "@workspace/db";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
import { requireOrgUser } from "../lib/rbac";
import { getRequestUser } from "../lib/request-user";
import { getSettings } from "../lib/settings";

const router: IRouter = Router();

function resolveMonth(raw: unknown): string {
  if (typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return new Date().toISOString().slice(0, 7);
}

function monthBounds(yyyyMM: string) {
  const [y, m] = yyyyMM.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = `${y}-${pad(m)}-01 00:00:00`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const next = `${ny}-${pad(nm)}-01 00:00:00`;
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  const prev = `${py}-${pad(pm)}-01 00:00:00`;
  return { start, next, prev };
}

function rangeWhere(orgId: number, start: string, end: string) {
  return and(
    eq(paymentsTable.orgId, orgId),
    gte(sql`datetime(${paymentsTable.paidAt})`, sql`datetime(${start})`),
    lt(sql`datetime(${paymentsTable.paidAt})`, sql`datetime(${end})`),
  );
}

function build12Months(selectedMonth: string): string[] {
  const [y, m] = selectedMonth.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    let mo = m - i;
    let yr = y;
    while (mo <= 0) {
      mo += 12;
      yr--;
    }
    months.push(`${yr}-${pad(mo)}`);
  }
  return months;
}

router.use("/reports", requireAuth, requireOrgUser);

router.get("/reports/revenue", async (req, res): Promise<void> => {
  const user = getRequestUser(req);
  const orgId = user.orgId!;
  const selectedMonth = resolveMonth(req.query.month);
  const { start, next, prev } = monthBounds(selectedMonth);

  const months = build12Months(selectedMonth);
  const trendStart = `${months[0]}-01 00:00:00`;

  const [totalResult, byProduct, prevResult, trendRows, settings] = await Promise.all([
    db.select({
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
      paymentsCount: sql<number>`count(${paymentsTable.id})`,
    }).from(paymentsTable).where(rangeWhere(orgId, start, next)).get(),
    db.select({
      productId: productsTable.id,
      productName: productsTable.name,
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
      paymentsCount: sql<number>`count(${paymentsTable.id})`,
    })
      .from(paymentsTable)
      .innerJoin(subscriptionsTable, eq(paymentsTable.subscriptionId, subscriptionsTable.id))
      .innerJoin(slotsTable, eq(subscriptionsTable.slotId, slotsTable.id))
      .innerJoin(accountsTable, eq(slotsTable.accountId, accountsTable.id))
      .innerJoin(productsTable, eq(accountsTable.productId, productsTable.id))
      .where(rangeWhere(orgId, start, next))
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.name)),
    db.select({ revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
      .from(paymentsTable)
      .where(rangeWhere(orgId, prev, start))
      .get(),
    db.select({
      month: sql<string>`strftime('%Y-%m', ${paymentsTable.paidAt})`,
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
    })
      .from(paymentsTable)
      .where(rangeWhere(orgId, trendStart, next))
      .groupBy(sql`strftime('%Y-%m', ${paymentsTable.paidAt})`),
    getSettings(orgId),
  ]);

  const revenue = totalResult?.revenue ?? 0;
  const paymentsCount = totalResult?.paymentsCount ?? 0;
  const avgPayment = paymentsCount > 0 ? revenue / paymentsCount : 0;
  const prevMonthRevenue = prevResult?.revenue ?? 0;

  const trendMap = new Map(trendRows.map((row) => [row.month, row.revenue]));
  const monthly = months.map((month) => ({ month, revenue: trendMap.get(month) ?? 0 }));

  res.json({
    month: selectedMonth,
    currency: settings.currency,
    revenue,
    paymentsCount,
    avgPayment,
    prevMonthRevenue,
    byProduct,
    monthly,
  });
});

export default router;
