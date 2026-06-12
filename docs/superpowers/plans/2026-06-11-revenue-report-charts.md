# Revenue Report Charts & Statistics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Revenue Report page from a single total card into an analytics view with a 12-month trend bar chart, per-product horizontal bar chart, stat cards, and a month selector.

**Architecture:** Extend the existing `/api/reports/revenue` route to accept a `?month=YYYY-MM` param and return richer data (trend, stats); update the `RevenueReport` type and `useGetRevenueReport` hook to forward the param; rebuild the page using recharts `BarChart` via the existing `ChartContainer`.

**Tech Stack:** Express + Drizzle ORM (backend), React + TanStack Query + recharts + shadcn Select (frontend), TypeScript throughout.

---

## File Map

| File | Change |
|------|--------|
| `artifacts/api-server/src/routes/reports.ts` | Full rewrite — parameterized month, range helper, 12-month trend, stats |
| `artifacts/accounts-manager/src/lib/phase3-api.ts` | Extend `RevenueReport` type, update `useGetRevenueReport` signature |
| `artifacts/accounts-manager/src/lib/strings.ts` | Add `revenueTrend`, `selectMonth`, `averagePayment`, `changeVsPrevMonth`, `monthNames` |
| `artifacts/accounts-manager/src/pages/revenue-report.tsx` | Full rewrite — month selector, stat cards, trend chart, product chart + list |

---

### Task 1: Backend — extend the revenue endpoint

**Files:**
- Modify: `artifacts/api-server/src/routes/reports.ts`

- [ ] **Step 1: Rewrite `reports.ts` with month param support, range helper, and full response shape**

Replace the entire file with:

```typescript
import { Router, type IRouter } from "express";
import { accountsTable, db, paymentsTable, productsTable, slotsTable, subscriptionsTable } from "@workspace/db";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { requireAuth } from "../lib/session";
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

function rangeWhere(start: string, end: string) {
  return and(
    gte(sql`datetime(${paymentsTable.paidAt})`, sql`datetime(${start})`),
    lt(sql`datetime(${paymentsTable.paidAt})`, sql`datetime(${end})`)
  );
}

function build12Months(selectedMonth: string): string[] {
  const [y, m] = selectedMonth.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    let mo = m - i;
    let yr = y;
    while (mo <= 0) { mo += 12; yr--; }
    months.push(`${yr}-${pad(mo)}`);
  }
  return months;
}

router.get("/reports/revenue", requireAuth, async (req, res): Promise<void> => {
  const selectedMonth = resolveMonth(req.query.month);
  const { start, next, prev } = monthBounds(selectedMonth);

  const months = build12Months(selectedMonth);
  const trendStart = `${months[0]}-01 00:00:00`;

  const [totalResult, byProduct, prevResult, trendRows, settings] = await Promise.all([
    db.select({
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
      paymentsCount: sql<number>`count(${paymentsTable.id})`,
    }).from(paymentsTable).where(rangeWhere(start, next)).get(),

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
      .where(rangeWhere(start, next))
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.name)),

    db.select({ revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)` })
      .from(paymentsTable).where(rangeWhere(prev, start)).get(),

    db.select({
      month: sql<string>`strftime('%Y-%m', ${paymentsTable.paidAt})`,
      revenue: sql<number>`coalesce(sum(${paymentsTable.amount}), 0)`,
    })
      .from(paymentsTable)
      .where(rangeWhere(trendStart, next))
      .groupBy(sql`strftime('%Y-%m', ${paymentsTable.paidAt})`),

    getSettings(),
  ]);

  const revenue = totalResult?.revenue ?? 0;
  const paymentsCount = totalResult?.paymentsCount ?? 0;
  const avgPayment = paymentsCount > 0 ? revenue / paymentsCount : 0;
  const prevMonthRevenue = prevResult?.revenue ?? 0;

  const trendMap = new Map(trendRows.map((r) => [r.month, r.revenue]));
  const monthly = months.map((m) => ({ month: m, revenue: trendMap.get(m) ?? 0 }));

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
```

- [ ] **Step 2: Typecheck the API server**

Run: `cd artifacts/api-server && pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/reports.ts
git commit -m "feat: extend revenue endpoint with month param, trend, and stats"
```

---

### Task 2: Frontend data layer — update type and hook

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/phase3-api.ts`

- [ ] **Step 1: Extend `RevenueReport` type and update `useGetRevenueReport`**

Find and replace the `RevenueReport` type line (line 21):

```typescript
export type RevenueReport = { total: number; currency?: string; products: { productId: number; productName: string; revenue: number; paymentsCount?: number }[] };
```

Replace with:

```typescript
export type RevenueReport = {
  month: string;
  total: number;
  currency?: string;
  paymentsCount: number;
  avgPayment: number;
  prevMonthRevenue: number;
  monthly: { month: string; revenue: number }[];
  products: { productId: number; productName: string; revenue: number; paymentsCount?: number }[];
};
```

Find and replace `useGetRevenueReport` (line 47):

```typescript
export const useGetRevenueReport = () => useQuery({ queryKey: ["phase3", "revenue"], queryFn: async () => { const raw = await request<any>("/api/reports/revenue"); return { total: raw.revenue, products: raw.byProduct, currency: raw.currency } as RevenueReport; } });
```

Replace with:

```typescript
export const useGetRevenueReport = (month?: string) => useQuery({
  queryKey: ["phase3", "revenue", month],
  queryFn: async () => {
    const raw = await request<any>(`/api/reports/revenue${query({ month })}`);
    return {
      month: raw.month,
      total: raw.revenue,
      currency: raw.currency,
      paymentsCount: raw.paymentsCount ?? 0,
      avgPayment: raw.avgPayment ?? 0,
      prevMonthRevenue: raw.prevMonthRevenue ?? 0,
      monthly: raw.monthly ?? [],
      products: raw.byProduct,
    } as RevenueReport;
  },
});
```

- [ ] **Step 2: Typecheck the frontend**

Run: `cd artifacts/accounts-manager && pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add artifacts/accounts-manager/src/lib/phase3-api.ts
git commit -m "feat: extend RevenueReport type and useGetRevenueReport with month param"
```

---

### Task 3: Frontend strings — Arabic month names and new labels

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`

- [ ] **Step 1: Add new strings to the `phase3` block**

In `strings.ts`, find the end of the `phase3` block — the line that reads:

```typescript
    paymentsCount: "عدد الدفعات", adminOnly: "هذه الصفحة متاحة للمدير فقط", loading: "جارٍ التحميل...", save: "حفظ", close: "إغلاق", notes: "ملاحظات",
```

Add four new string keys and the Arabic month-name array immediately after `notes: "ملاحظات",` on that same line (or on the next line before the closing `}`):

Append these entries inside the `phase3` block, before its closing `}`:

```typescript
    revenueTrend: "اتجاه الإيرادات الشهرية",
    selectMonth: "اختر الشهر",
    averagePayment: "متوسط الدفعة",
    changeVsPrevMonth: "التغيير مقارنة بالشهر السابق",
    monthNames: ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"] as const,
```

- [ ] **Step 2: Typecheck**

Run: `cd artifacts/accounts-manager && pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add artifacts/accounts-manager/src/lib/strings.ts
git commit -m "feat: add revenue chart strings and Arabic month names"
```

---

### Task 4: Frontend page — rebuild with charts, stat cards, and month selector

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/revenue-report.tsx`

- [ ] **Step 1: Rewrite `revenue-report.tsx`**

Replace the entire file with:

```tsx
import { useState } from "react";
import { CircleDollarSign, CreditCard, BarChart3, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell } from "recharts";
import { useGetRevenueReport } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

function formatMonthLabel(yyyyMM: string): string {
  const [year, month] = yyyyMM.split("-");
  return `${strings.phase3.monthNames[parseInt(month) - 1]} ${year}`;
}

function getLast12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export default function RevenueReport() {
  const last12 = getLast12Months();
  const [selectedMonth, setSelectedMonth] = useState(last12[0]);

  const { data } = useGetRevenueReport(selectedMonth);
  const currency = data?.currency || strings.common.currency;

  const formatRevenue = (revenue: number, hasPayments: boolean) =>
    revenue === 0 && hasPayments ? strings.phase3.refunded : `${revenue} ${currency}`;

  const currRev = data?.total ?? 0;
  const prevRev = data?.prevMonthRevenue ?? 0;
  const pctChange = prevRev !== 0 ? ((currRev - prevRev) / Math.abs(prevRev)) * 100 : null;

  const trendConfig = { revenue: { label: strings.phase3.monthlyRevenue, color: "hsl(var(--primary))" } };
  const productConfig = { revenue: { label: strings.phase3.revenueByProduct, color: "hsl(var(--primary))" } };

  return (
    <div className="space-y-5">
      {/* Header + month selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{strings.phase3.report}</h1>
        <Select value={selectedMonth} onValueChange={setSelectedMonth}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {last12.map((m) => (
              <SelectItem key={m} value={m}>{formatMonthLabel(m)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="flex items-center gap-4 p-6">
            <CircleDollarSign className="h-9 w-9" />
            <div>
              <p>{strings.phase3.monthlyRevenue}</p>
              <strong className="text-3xl">{formatRevenue(currRev, (data?.paymentsCount ?? 0) > 0)}</strong>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <CreditCard className="h-9 w-9 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">{strings.phase3.paymentsCount}</p>
              <strong className="text-2xl">{data?.paymentsCount ?? 0}</strong>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <BarChart3 className="h-9 w-9 text-muted-foreground" />
            <div>
              <p className="text-sm text-muted-foreground">{strings.phase3.averagePayment}</p>
              <strong className="text-2xl">{(data?.avgPayment ?? 0).toFixed(1)} {currency}</strong>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            {pctChange !== null && pctChange >= 0
              ? <TrendingUp className="h-9 w-9 text-green-500" />
              : <TrendingDown className="h-9 w-9 text-red-500" />
            }
            <div>
              <p className="text-sm text-muted-foreground">{strings.phase3.changeVsPrevMonth}</p>
              <strong className={`text-2xl ${pctChange === null ? "" : pctChange >= 0 ? "text-green-500" : "text-red-500"}`}>
                {pctChange === null ? "—" : `${pctChange >= 0 ? "+" : ""}${pctChange.toFixed(1)}%`}
              </strong>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 12-month trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>{strings.phase3.revenueTrend}</CardTitle>
        </CardHeader>
        <CardContent>
          <div dir="ltr">
            <ChartContainer config={trendConfig} className="h-56 w-full">
              <BarChart data={data?.monthly ?? []}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="month"
                  tickFormatter={(v: string) => strings.phase3.monthNames[parseInt(v.split("-")[1]) - 1]}
                />
                <YAxis />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_: unknown, payload: unknown[]) => {
                        if (!payload?.length) return "";
                        return formatMonthLabel((payload[0] as { payload: { month: string } }).payload.month);
                      }}
                      formatter={(value: unknown) => [`${value} ${currency}`, strings.phase3.monthlyRevenue]}
                    />
                  }
                />
                <Bar dataKey="revenue">
                  {(data?.monthly ?? []).map((entry) => (
                    <Cell
                      key={entry.month}
                      fill={entry.month === selectedMonth ? "hsl(var(--primary))" : "hsl(var(--primary) / 0.35)"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        </CardContent>
      </Card>

      {/* Revenue by product */}
      <Card>
        <CardHeader>
          <CardTitle>{strings.phase3.revenueByProduct}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {(data?.products.length ?? 0) > 0 && (
            <div dir="ltr">
              <ChartContainer config={productConfig} className="h-40 w-full">
                <BarChart layout="vertical" data={data?.products ?? []}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="productName" width={90} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value: unknown) => [`${value} ${currency}`, strings.phase3.monthlyRevenue]}
                      />
                    }
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ChartContainer>
            </div>
          )}

          <div className="space-y-3">
            {data?.products.map((item) => (
              <div key={item.productId} className="flex items-center justify-between rounded-md border p-4">
                <span>
                  {item.productName}
                  <small className="block text-muted-foreground">{strings.phase3.paymentsCount}: {item.paymentsCount || 0}</small>
                </span>
                <strong>{formatRevenue(item.revenue, (item.paymentsCount ?? 0) > 0)}</strong>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck the frontend**

Run: `cd artifacts/accounts-manager && pnpm run typecheck`
Expected: no errors

- [ ] **Step 3: Build the frontend**

Run: `cd artifacts/accounts-manager && pnpm run build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add artifacts/accounts-manager/src/pages/revenue-report.tsx
git commit -m "feat: rebuild revenue report page with charts, stat cards, and month selector"
```

---

## Manual Verification Checklist

After all tasks are done, verify in the running app:

1. Revenue page loads — shows 12-month trend bar chart and current-month stat cards
2. Switch month selector — breakdown chart, product list, and stat cards update; trend chart stays stable (12-month window shifts)
3. Selected month bar in trend chart is visually emphasized (brighter fill)
4. Arabic month labels in selector and chart axis render correctly
5. Pick a month with a refund — net total, product bar, and trend bar all show the netted (lower) figure
6. Page renders cleanly at narrow width (375px), RTL layout intact
7. `pnpm run typecheck` and `pnpm run build` both pass in `artifacts/accounts-manager`
