# UI / UX & Quality Problems — Accounts Manager (`artifacts/accounts-manager`)

Audit of the React/Tailwind/shadcn front-end. The app is an Arabic, RTL, single-currency
subscription/accounts manager. Findings are grouped by severity. Each item lists the file(s)
and why it matters to the user.

---

---
> **Status** — items marked ✅ have been fixed. Remaining items are open.
---

## 🔴 High severity (broken, confusing, or visibly wrong)

### ✅ 1. "Page not found" screen is an English developer placeholder
`src/pages/not-found.tsx`
- Shows **"404 Page Not Found"** and **"Did you forget to add the page to the router?"** — English,
  developer-facing text dropped into an otherwise fully Arabic, RTL app.
- Uses hardcoded `bg-gray-50`, `text-gray-900`, `text-gray-600`, `text-red-500` instead of theme
  tokens, so it ignores the design system (and would look wrong in dark mode).
- Renders outside `Layout`, so a lost user has **no navigation** to get back. There's no "go home" link.

### ✅ 2. New-sale wizard step numbers don't match the step order
`src/pages/new-sale.tsx` + `src/lib/strings.ts`
- The wizard flow is: 1) Product → 2) Customer → 3) Slot → 4) Dates/Price → 5) Confirm.
- But the card titles pulled from `strings.sale` are numbered for a *different* order:
  - Step 2 (Customer) shows title `"3. اختر العميل"`.
  - Step 3 (Slot) shows title `"2. اختر الخانة"`.
  - Step 5 (Confirm) shows title `"6. تأكيد البيع"` — but there are only 5 dots in the progress bar.
- So the progress indicator highlights dot #2 while the heading says "3", and the final step says "6
  of 5". Very confusing. `strings.sale.paymentStep ("5. ...")` is also dead/unused.

### ✅ 3. Delete failures are silent on Products and Accounts
`src/pages/products.tsx`, `src/pages/accounts.tsx`
- Both delete mutations only handle `onSuccess` — there is **no `onError`**. If the API blocks the
  delete (e.g. an account still has active subscriptions / a product still has accounts), the dialog
  closes and **nothing happens visibly**: no toast, no error, the row stays. The user assumes a bug.
- Inconsistent with `src/pages/customers.tsx`, which *does* show a `deleteBlocked` error toast.

### ✅ 4. "Expiring soon" page has no empty state
`src/pages/expiring.tsx`
- When `data.length === 0` it renders an empty grid — a blank page with just the heading. Every other
  list page (customers, products, accounts, subscriptions) has a proper empty state with icon + text.
- The "good news, nothing is expiring" case looks like a broken/loading page.

### ✅ 5. "Expiring soon" subtitle is wrong for 1- and 3-day filters
`src/pages/expiring.tsx` line 12
- Subtitle is `${strings.phase3.withinSevenDays}: ${days}` → literally **"خلال 7 أيام: 1"** even when
  the filter is 1 day or 3 days. The "within 7 days" label is hardcoded regardless of the actual filter.

### ✅ 6. Pinch-to-zoom disabled (accessibility)
`index.html` line 5
- `maximum-scale=1` in the viewport meta prevents users from zooming the page. This blocks
  low-vision users and fails WCAG 1.4.4. Remove `maximum-scale=1`.

---

## 🟠 Medium severity (degraded experience / inconsistency)

### ✅ 7. Raw ISO timestamps shown to users instead of formatted dates
`src/pages/audit.tsx` (`entry.createdAt`), `src/pages/subscription-detail.tsx` (`payment.paidAt`)
- Timestamps are printed directly (e.g. `2026-06-10T13:42:00.000Z`) with no localization or
  formatting, even though `date-fns` is already a dependency and used in new-sale. Should be a
  readable date/time.

### ✅ 8. Audit log shows raw English action keys
`src/pages/audit.tsx` lines 35, `entry.action`
- The filter dropdown and each row display raw machine values: `sale`, `renew`, `credential_reveal`,
  `settings_update`, `user_password_reset`, `subscription_cancel`, etc. — untranslated English snake_case
  inside an Arabic admin screen. These need an Arabic label map.

### 9. Dark mode is fully built but unreachable
`src/index.css` (complete `.dark` theme), `package.json` (`next-themes` installed)
- A complete dark palette exists and `next-themes` is a dependency, but there is **no ThemeProvider and
  no theme toggle** anywhere (not in `App.tsx`, not in `layout.tsx`). The dark theme is dead code and
  users on dark-preference devices still get the light theme. Either wire it up or remove the unused dependency/CSS.

### 10. Numbers/prices/revenue are not localized or thousands-separated
Dashboard `monthlyRevenue`, revenue report, subscription cards, etc.
- Values are interpolated raw: `{data.totals.monthlyRevenue} {currency}`, `{sub.price} {currency}`.
  Large amounts render as `1234567 د.أ` with no grouping. Use `Intl.NumberFormat` for readability.

### ✅ 11. Icon-only action buttons have no accessible label
`src/pages/customers.tsx`, `accounts.tsx`, `products.tsx`, `users.tsx`
- Edit (`Edit2`), delete (`Trash2`), reset-password (`KeyRound`) buttons are `size="icon"` with only an
  icon — no `aria-label` / `sr-only` text. Screen readers announce an empty button. (The mobile menu and
  logout buttons do this correctly with `sr-only` / text — the list actions don't.)

### 12. Inconsistent loading states across pages
- `dashboard.tsx` has a polished skeleton.
- `customers/products/accounts/subscriptions/expiring` use a centered spinner.
- `settings.tsx`, `revenue-report.tsx`, `users.tsx` have **no loading state at all** — they flash default
  values (e.g. revenue "0", empty user list, default settings) before data arrives. Settings briefly shows
  placeholder defaults that look like real saved values.

### ✅ 13. Delete-confirmation copy is mismatched
`src/pages/customers.tsx` line 32
- The `AlertDialogDescription` reuses `strings.customers.deleteBlocked` ("قد لا يمكن حذف عميل لديه
  اشتراكات" = a *failure/blocked* message) as the **confirmation prompt** body. Reads as if the delete
  already failed before the user has confirmed.

### 14. Shadows are globally disabled, leaving the UI flat
`src/index.css` lines 147-154 / 229-236
- Every `--shadow-*` token is defined with `/ 0.00` alpha (fully transparent). So `shadow-sm` (e.g. on the
  prominent "New sale" nav item, line 55 of `layout.tsx`) does nothing. Cards (`bg-card` pure white) sit on
  a near-white background (`210 40% 98%`) separated only by a faint border — low depth/separation. If flat
  is intentional, the `shadow-sm` class on the nav item is misleading dead styling.

### 15. Query-string filter on Expiring isn't reactive
`src/pages/expiring.tsx` line 10
- Reads `window.location.search` directly instead of `wouter`'s location. The component stays mounted on
  `/expiring`, so navigating between `?days=1`, `?days=3`, `?days=7` (e.g. via the dashboard links) may not
  re-trigger a re-read of the param and re-fetch. Use the router's location hook.

---

## 🟡 Low severity (polish / consistency / maintainability)

### 16. Hardcoded Arabic strings bypass the central `strings` module
- Many user-visible strings are inline instead of in `src/lib/strings.ts`, breaking the single-source i18n
  pattern: `new-sale.tsx` ("التالي", "مباع بالكامل", "تلقائي", "مقعد", "المنتج:", "العميل:", "الخانة:"),
  `audit.tsx` ("السابق", "التالي", "صفحة"), `accounts.tsx` ("لا توجد منتجات", "يجب إضافة منتج أولاً...",
  "من ... خانات"), `account-form-dialog.tsx` ("اتركه فارغاً للاحتفاظ بالحالي"), `products.tsx`
  ("السعر", "السعة", "المدة", "يوم"). Makes wording inconsistent and hard to maintain.

### 17. Status badge colors are hardcoded for light mode
`subscription-status-badge.tsx`, `accounts.tsx` (`getStatusBadge`)
- Badges use fixed `text-green-700` / `text-red-700` on `*-500/10` backgrounds. In dark mode (if enabled)
  these dark-700 text colors on translucent fills would have poor contrast. Should use theme-aware tokens.

### 18. WhatsApp links strip the leading `+` / may drop country code
`customers.tsx`, `customer-detail.tsx`, `expiring.tsx`
- `phone.replace(/[^\d]/g, "")` removes `+` and any country-code formatting. `wa.me` needs the full
  international number; numbers stored locally (e.g. `079...`) will produce broken links with no validation
  or feedback.

### 19. Login has no password visibility toggle and no error inline
`src/pages/login.tsx`
- Password field has no show/hide toggle (common expectation). Wrong-credential feedback is only a transient
  toast — no persistent inline message. Minor but affects first impression.

### 20. Inconsistent code formatting / readability
- Several pages are written as one giant dense JSX line (`customers.tsx`, `subscriptions.tsx`,
  `expiring.tsx`, `revenue-report.tsx`, `users.tsx`) while others are cleanly formatted
  (`dashboard.tsx`, `new-sale.tsx`, `audit.tsx`). Not user-facing, but hurts maintainability and review.

### 21. Dead / unused code
- `strings.nav.stats` ("الإحصائيات") is defined but never used.
- `strings.sale.paymentStep` is unused after payment was merged into the dates step.
- `next-themes` dependency unused (see #9).

### 22. Revenue report total card has no empty/zero affordance
`src/pages/revenue-report.tsx`
- When there are no products/payments, the big primary card just shows `0 د.أ` and an empty list with no
  explanatory empty state.

---

## Suggested priority order
1. Fix the 404 page (#1) and silent delete failures (#3) — both make the app feel broken.
2. Fix the new-sale step numbering (#2) — it's on the core selling flow.
3. Add the Expiring empty state + correct subtitle (#4, #5) and re-enable zoom (#6).
4. Format dates (#7) and translate audit actions (#8).
5. Decide on dark mode (#9) — wire it up or remove the dead theme/dependency.
6. Sweep accessibility labels (#11) and number formatting (#10).
