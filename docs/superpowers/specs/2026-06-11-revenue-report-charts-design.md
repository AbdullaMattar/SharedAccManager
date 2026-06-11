# Revenue Report Charts & Statistics — Design

**Date:** 2026-06-11
**Status:** Approved (design phase)
**Page:** `تقرير الإيرادات` (`artifacts/accounts-manager/src/pages/revenue-report.tsx`)

## Goal

Turn the Revenue Report page from a single total + flat product list into an
analytics view that answers two questions:

1. **Is the business growing?** — a 12-month revenue trend.
2. **Where did this month's money come from?** — per-product breakdown and key
   stats, for any month the operator selects.

## Scope

In scope:

- **Monthly revenue trend** — net revenue per month for the last 12 months (bar chart).
- **Revenue-by-product chart** — horizontal bars for the selected month.
- **Key stat cards** — payments count, average payment, and % change vs the
  previous month, for the selected month.
- **Month selector** — a dropdown of the last 12 months; the breakdown chart and
  stat cards follow the selection. The trend chart always shows the full window.

Out of scope:

- Payment-method split chart (deliberately dropped during brainstorming).
- Any change to how payments/refunds are recorded.
- Migrating this endpoint into the OpenAPI/Orval pipeline (see "Contract note").

## Key domain facts

- Revenue is computed from `payments` rows, not subscription prices (CONTEXT.md).
- **Refunds are stored as negative `payments.amount` rows.** Therefore summing
  `amount` over a period already yields *net* revenue. The trend, breakdown, and
  stats all use plain `SUM(amount)` and inherit correct net behavior — a month or
  product can legitimately show a negative or zero net value.
- The current endpoint scopes "this month" with
  `datetime(paid_at) >= datetime('now','start of month')`. The new selected-month
  logic generalizes this to an explicit `[month start, next month start)` range.

## Backend

### Endpoint (Approach A — extend the existing route)

`GET /api/reports/revenue?month=YYYY-MM` in
`artifacts/api-server/src/routes/reports.ts`, behind `requireAuth` (unchanged).

- `month` is optional. When absent or malformed, default to the current month.
  Validate shape with a `^\d{4}-(0[1-9]|1[0-2])$` check; on mismatch, fall back to
  current month rather than erroring (keeps the page resilient).
- Compute the selected month's half-open range in SQLite:
  - `start  = datetime(<month>-01 00:00:00)`
  - `next   = datetime(<start>, '+1 month')`
  - `prev   = datetime(<start>, '-1 month')`
- A reusable helper builds a `paid_at` range condition from two bounds so the
  current-month, previous-month, and breakdown queries share one expression.

### Response shape

```jsonc
{
  "month": "2026-06",                // the resolved selected month
  "currency": "USD",
  "revenue": 1234.5,                  // net SUM(amount) for selected month
  "paymentsCount": 42,               // COUNT(*) for selected month
  "avgPayment": 29.4,                // revenue / paymentsCount (0 when count = 0)
  "prevMonthRevenue": 980.0,         // net SUM(amount) for the prior month
  "byProduct": [                     // selected month, grouped by product
    { "productId": 1, "productName": "Netflix", "revenue": 600, "paymentsCount": 20 }
  ],
  "monthly": [                       // last 12 months ending at selected month
    { "month": "2025-07", "revenue": 110.0 },
    // ... 12 entries, oldest → newest, zero-filled for empty months
  ]
}
```

Notes:

- `byProduct` keeps its existing fields and ordering (`ORDER BY products.name`),
  so the current refund-aware list rendering still works unchanged.
- `monthly` must contain exactly 12 contiguous entries (zero-filled), so the
  chart renders a stable axis even for months with no payments. Build the 12
  `YYYY-MM` keys in JS, run one grouped query
  (`GROUP BY strftime('%Y-%m', paid_at)`) over the 12-month window, then map
  results onto the pre-built keys defaulting to 0.

### Backwards compatibility

The response is a superset of today's payload (`month`, `revenue`, `byProduct`,
`currency` retained with identical meaning), so no other consumer breaks.

## Frontend

### Data layer — `artifacts/accounts-manager/src/lib/phase3-api.ts`

- Extend `RevenueReport` type with `paymentsCount`, `avgPayment`,
  `prevMonthRevenue`, and `monthly: { month: string; revenue: number }[]`.
- `useGetRevenueReport(month?: string)` takes an optional month, includes it in
  the query key (`["phase3","revenue", month]`) and the request querystring via
  the existing `query()` helper. Each selected month is cached independently;
  switching back to a visited month is instant.

### Page — `artifacts/accounts-manager/src/pages/revenue-report.tsx`

Layout top → bottom (mobile-first, works at 375px, RTL):

1. **Header** `h1` + a `Select` (shadcn) of the last 12 months on the same row,
   wrapping on narrow screens. Default value = current month.
2. **Stat cards** — a 3-up grid that collapses to 1 column on the narrowest
   screens:
   - Monthly net revenue (the existing hero card, kept).
   - Payments count.
   - Average payment.
   - % change vs previous month, with an up/down arrow and green/red color.
     When `prevMonthRevenue` is 0, show "—" instead of a divide-by-zero %.
3. **Monthly trend** — `recharts` `BarChart` via the existing `ChartContainer`
   (`components/ui/chart.tsx`). Wrapped in a `dir="ltr"` container so the time
   axis reads left→right (recharts has no RTL axis mode); Arabic month labels and
   Arabic tooltip content. The bar for the currently selected month is visually
   emphasized (distinct fill).
4. **Revenue by product** — horizontal `BarChart` (`layout="vertical"`) for the
   selected month, product name on the category axis, amount as bar length.
   Beneath it, keep the existing per-product list (it carries the
   refunded/payments-count detail the chart can't show). The refund-aware
   `formatRevenue` logic is reused as-is.

### Month label formatting

Add a small helper that turns `"2026-06"` into an Arabic label
(e.g. `"يونيو 2026"`). Implemented with a 12-entry Arabic month-name array keyed
by the numeric month, to avoid depending on `Intl` locale data being present in
the runtime. Used by both the selector and the chart axes/tooltips.

### Strings — `artifacts/accounts-manager/src/lib/strings.ts`

Add to the `phase3` block: `revenueTrend`, `selectMonth`, `averagePayment`,
`changeVsPrevMonth`, and the Arabic month-name array. Reuse the existing
`paymentsCount`, `monthlyRevenue`, `revenueByProduct`, `refunded`, `loading`.

### Empty / edge states

- No payments in the selected month: stat cards show 0 / "—", the product chart
  and list render empty (existing list already handles an empty array), the trend
  chart still renders its 12-month axis.
- Negative net month (refund-heavy): charts must not assume a non-negative domain;
  let recharts auto-scale so a negative bar is visible.

## Contract note

This endpoint lives in the hand-written `phase3-api.ts`, which CONTEXT.md
documents as known OpenAPI contract drift. This change intentionally stays
consistent with that existing pattern rather than expanding scope to migrate the
revenue endpoints into OpenAPI/Orval.

## Verification (no automated tests exist)

- `pnpm run typecheck` and `pnpm run build` must pass.
- Manual: load the page, confirm trend shows 12 months, switch the month selector
  and confirm breakdown + stat cards update while the trend window stays stable.
- Manual money check: pick a month containing a refund and confirm the net total,
  the product bar, and the trend bar all reflect the netted (lower) figure
  consistently.
- Confirm RTL layout and Arabic labels at 375px width.
