# Quality & UX Fixes — Design Spec
Date: 2026-06-10

## Scope

Three areas: New Sale wizard redesign, Dashboard improvements, and scattered code-quality fixes. No backend schema changes. All numbers displayed in English digits (1, 2, 3) throughout.

---

## 1. New Sale Wizard (`artifacts/accounts-manager/src/pages/new-sale.tsx`)

### Overview
Replace the current single-page "all steps visible at once" layout with a true one-step-at-a-time wizard. The active step is the only fully interactive card; completed steps appear above it as collapsed summary chips that are clickable to go back and edit.

### Progress indicator
A row of numbered step badges at the top of the page:
- Completed: filled circle with checkmark, clickable
- Active: filled circle with step number, highlighted
- Upcoming: outline circle with step number, not clickable

Steps: 1 Product → 2 Customer → 3 Slot → 4 Dates & Price → 5 Confirm

### Step 1 — Product
- Grid of product cards (2 columns on mobile, 3 on desktop)
- Each card shows: product name, free slot count badge ("3 مقاعد متاحة")
- If `freeSlotCount === 0`: card is dimmed, cursor not-allowed, label "مباع بالكامل"
- Clicking an available card selects it and auto-advances to Step 2
- No "Next" button needed — selection is the action

### Step 2 — Customer
- Single search `<Input>` at top, placeholder "ابحث بالاسم أو الهاتف"
- Results appear as a list below the input (max-height scroll), each row: name + phone
- Clicking a result selects the customer and auto-advances to Step 3
- Below the results list: a collapsed "＋ إضافة عميل جديد" toggle
  - Expands to show name + phone inputs and a "حفظ وتابع" button
  - On success: creates customer, selects them, advances to Step 3
  - Hidden by default — not shown at the same time as search results

### Step 3 — Slot Assignment
- Only rendered if the selected product has slots spread across more than one account (i.e., `slots` contain more than one distinct `accountId`)
- If only one account exists: step is skipped silently (wizard jumps 2→4)
- Default: "تعيين تلقائي" — description: "سيُختار أقدم مقعد متاح تلقائياً"
- Manual option: dropdown showing `accountLabel · مقعد N` for each free slot
- "التالي" button to advance

### Step 4 — Dates & Price
- Start date: `<input type="date">`, default today
- Expiry date: `<input type="date">`, auto-calculated as `startDate + product.defaultDurationDays`, user-editable
- When start date changes, expiry recalculates only if user has not manually edited expiry
- Price: `<input type="number">`, pre-filled from `product.defaultPrice`
- Payment amount: separate field, mirrors price on product selection but independently editable thereafter
- Payment method: select (نقداً / تحويل / أخرى)
- Paid at: `<input type="datetime-local">`, default now
- Notes: `<textarea>`, optional
- "التالي" button, disabled if `expiryDate < startDate`

### Step 5 — Confirm
- Summary card showing all selections:
  - Product name
  - Customer name + phone
  - Slot: account label + slot number, or "تلقائي" if auto
  - Start → Expiry dates
  - Price + payment amount + method
- Large "إتمام البيع" button (full width)
- On success: replace page content with full-screen success state
  - Green checkmark icon
  - "تم البيع بنجاح"
  - Button: "عرض الاشتراك" → navigates to `/subscriptions/{id}`

### Error handling
- Per-step validation on "التالي" / advance: show inline error below the relevant field, not a toast
- API errors on submit: toast with the server's Arabic error message

---

## 2. Dashboard (`artifacts/accounts-manager/src/pages/dashboard.tsx`)

### Expiring counts — replace 3 amber cards with 1 alert card
Remove the three separate amber `<Card>` components. Replace with a single "تنبيهات التجديد" card containing three clickable rows:

```
خلال 24 ساعة      [count]   ←  links to /expiring?days=1
خلال 3 أيام       [count]   ←  links to /expiring?days=3
خلال 7 أيام       [count]   ←  links to /expiring?days=7
```

- All counts in English digits
- Each row is a full-width link (`<Link>`)
- Row with count > 0 shows count in amber/orange; count = 0 shows in muted gray

### Overdue list — fix negative days + add quick renew
- Days calculation: `Math.abs(daysRemaining)` displayed as "متأخر N يوم" in red (`text-destructive`)
- If `daysRemaining === 0`: "ينتهي اليوم" in amber
- Add a "تجديد" button (small, outline variant) on each overdue row
- Clicking "تجديد" opens the existing `RenewSubscriptionDialog` inline (already exists as a component)

### Free slots — add capacity bar
Replace `productName | number` rows with:
```
[productName]    [███░░]  3 / 5
```
- `freeSlots` and total slots come from the dashboard API response (`freeSlotsByProduct`)
- The API currently only returns `freeSlots` count, not total. The dashboard endpoint must also return total slots per product. Update `routes/dashboard.ts` to include `totalSlots` in the `freeSlotsByProduct` query.
- Progress bar: `w-full` container, filled portion = `(total - free) / total * 100%`, color: green if >50% free, amber if 20-50%, red if <20%
- Clicking a row links to `/accounts?productId={id}`

### Totals row — make items into links
- Active subscriptions card → links to `/subscriptions?status=active`
- Total accounts card → links to `/accounts`
- Monthly revenue card → links to `/reports/revenue`

### Loading state
Replace full-screen `<Loader2>` spinner with skeleton cards matching the layout (3 skeleton rows for expiring, 3 skeleton cards for totals, 2 skeleton lists).

---

## 3. Code Quality Fixes

### Login page (`artifacts/accounts-manager/src/pages/login.tsx`)
- Move `setLocation("/products")` from render body into a `useEffect(() => { if (isAuthenticated) setLocation("/") }, [isAuthenticated])` — navigate to `/` (dashboard), not `/products`
- Remove `window.location.href = "/products"` — use router navigation only
- Add `autocomplete="email"` to email input
- Add `autocomplete="current-password"` to password input

### Auth context (`artifacts/accounts-manager/src/lib/auth.tsx`)
- Replace `user: any` with the inferred return type from `useGetMe` query data
- Update `AuthContextType.user` to `ReturnType<typeof useGetMe>["data"]`

### Customer search LIKE escaping (`artifacts/api-server/src/routes/customers.ts`)
- Escape `%`, `_`, `\` in the search string before embedding in LIKE pattern
- Use SQLite's `ESCAPE` clause: `LIKE ? ESCAPE '\'`

### Accounts N+1 fix (`artifacts/api-server/src/routes/accounts.ts`)
- Replace the `Promise.all(accounts.map(async (a) => { db.select slots... }))` loop with a single query:
  `SELECT account_id, COUNT(*) as total, SUM(status='free') as free FROM slots WHERE account_id IN (...) GROUP BY account_id`
- Join the slot counts map onto the accounts array in JS

### Healthz duplicate (`artifacts/api-server/src/app.ts`)
- Remove line 42: `app.get("/api/healthz", (_req, res) => res.json({ ok: true }))`
- The route in `routes/health.ts` returns `{ status: "ok" }` per the OpenAPI spec — let it handle the endpoint

### Audit log offset (`artifacts/api-server/src/routes/stats.ts` + `lib/db/src/schema/phase3-validation.ts`)
- Add `offset: z.coerce.number().int().min(0).default(0)` to `auditQuerySchema`
- Apply `.offset(parsed.data.offset)` to the query in `stats.ts`
- Frontend audit page: add "تحميل المزيد" button that increments offset by current limit

### Dead dependencies (`artifacts/api-server/package.json`)
- Remove `jsonwebtoken` and `@types/jsonwebtoken` from `dependencies` (never imported)
- Move `@types/bcryptjs` from `dependencies` to `devDependencies`

### Repo clutter removal
Files to `git rm`:
- `artifacts/mockup-sandbox/` (entire directory — 69 files, scaffolding sandbox never used)
- `scripts/src/hello.ts` (hello-world placeholder)
- `replit-prompts/` (entire directory)
- `lib/api-spec/node_modules` (should not be committed)

---

## Files Changed

| File | Change |
|------|--------|
| `artifacts/accounts-manager/src/pages/new-sale.tsx` | Full rewrite — wizard |
| `artifacts/accounts-manager/src/pages/dashboard.tsx` | Expiring card, overdue days, capacity bar, skeleton, links |
| `artifacts/accounts-manager/src/pages/login.tsx` | useEffect redirect, autocomplete |
| `artifacts/accounts-manager/src/pages/audit.tsx` | Add offset / load-more |
| `artifacts/accounts-manager/src/lib/auth.tsx` | Replace `any` with typed user |
| `artifacts/api-server/src/app.ts` | Remove duplicate healthz |
| `artifacts/api-server/src/routes/accounts.ts` | N+1 → single grouped query |
| `artifacts/api-server/src/routes/customers.ts` | LIKE escape |
| `artifacts/api-server/src/routes/dashboard.ts` | Add `totalSlots` to freeSlotsByProduct |
| `artifacts/api-server/src/routes/stats.ts` | Add offset param |
| `lib/db/src/schema/phase3-validation.ts` | Add offset to auditQuerySchema |
| `artifacts/api-server/package.json` | Remove dead deps, fix devDeps |
| git history | Remove clutter directories |

## Out of Scope
- No backend schema migrations
- No auth / session changes
- No rate limiting or CORS changes (Phase 1 of the broader audit)
- No currency/float storage changes
