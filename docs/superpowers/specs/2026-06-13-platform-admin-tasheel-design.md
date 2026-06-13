# Design: Platform admin actions, suspended-banner fix, revenue chart, Tasheel attribution

Date: 2026-06-13

## Overview

Four changes to SharedAccManager:

1. Platform superadmin can hard-delete an organization (and all its data).
2. Fix the suspended-account login banner (currently broken by a client-side error-shape bug).
3. Declutter the "الإيرادات حسب المنتج" (revenue-by-product) chart.
4. Add Tasheel (تسهيل) attribution on the login page and a public About page.

No database migration is required.

---

## 1. Delete organizations (hard delete + confirm)

**Page:** `إدارة المنصة` (`artifacts/accounts-manager/src/pages/platform.tsx`) — rows are organizations (الأنشطة).

### Backend — `artifacts/api-server/src/routes/platform.ts`
- New route `DELETE /platform/orgs/:id`, superadmin-only (already covered by `router.use("/platform", requireAuth, requireSuperadmin)`).
- Reject `DEMO_ORG_ID` (1) with HTTP 400 `"لا يمكن حذف النشاط التجريبي"`.
- Validate `:id` with `idParamsSchema`.
- One `db.transaction` deleting children in FK-dependency order (foreign_keys is ON — see `lib/db/src/index.ts:44`):
  1. `payments` WHERE `orgId = id`
  2. `subscriptions` WHERE `orgId = id`
  3. `accounts` WHERE `orgId = id` (cascades to `slots` via `onDelete: "cascade"`)
  4. `products` WHERE `orgId = id`
  5. `customers` WHERE `orgId = id`
  6. `settings` WHERE `orgId = id`
  7. `audit_log` WHERE `orgId = id` OR `userId IN (SELECT id FROM users WHERE orgId = id)` — covers org-scoped logs plus any null-org logs that reference a user about to be deleted (avoids FK failure).
  8. `users` WHERE `orgId = id`
  9. the `organizations` row.
- After the org row is deleted, insert a `platform_delete_org` audit row (`orgId: null`, `userId: actor.id`, `entity: "organization"`, `entityId: id`, detail with the org name captured before deletion).
- Return `{ ok: true }`. 404 if the org did not exist.

### Frontend
- `artifacts/accounts-manager/src/lib/phase3-api.ts`: add `useDeleteOrg` mirroring `useSuspendOrg`:
  `mutationFn: ({ id }) => request(\`/api/platform/orgs/${id}\`, { method: "DELETE" })`.
- `platform.tsx`: add a destructive "حذف" button in the الإجراءات cell next to تعليق/إعادة تفعيل, wrapped in an `AlertDialog` (component exists at `components/ui/alert-dialog`) confirming permanent deletion of all org data. On confirm, call the mutation, then `reload()` (invalidate `["platform","orgs"]`); on error toast. Demo org (#1) keeps showing "النشاط التجريبي محمي" with no delete button.

---

## 2. Fix the suspended-account banner

### Root cause
`login.tsx` `onAuthError` reads `err?.response?.data?.error` (axios shape). The custom fetch client throws `ApiError` (see `lib/api-client-react/src/custom-fetch.ts`) where the parsed server body lives on **`err.data`** and `err.response` is the raw fetch `Response` (no `.data`). So every server error message — including the suspended-org message — falls through to the generic fallback `strings.auth.loginError` ("بيانات الاعتماد غير صحيحة") under title `strings.app.error` ("حدث خطأ غير متوقع"). This matches the reported symptom.

### Backend — `artifacts/api-server/src/routes/auth.ts`
- Change the suspended-org rejection (currently `res.status(401)`) to **HTTP 403** with `{ error: getSuspendedOrgError() }`, so the client can reliably distinguish a suspended account from bad credentials. Message text unchanged: "تم إيقاف حسابكم - يرجى التواصل مع الإدارة".

### Frontend — `artifacts/accounts-manager/src/pages/login.tsx`
- `onAuthError` reads the message from the `ApiError` shape: `err?.data?.error ?? err?.response?.data?.error ?? fallback`. This restores real server messages for all login/register errors (suspended org, duplicate email, etc.).
- When the error is the suspended case (HTTP 403 / `err.status === 403`), render a distinct, prominent banner (e.g. `Alert` with `ShieldAlert` icon and an amber/destructive style and a clear "الحساب موقوف" title) instead of the generic inline form error. Other errors keep the existing inline `Alert variant="destructive"`.

---

## 3. Revenue-by-product chart declutter

**File:** `artifacts/accounts-manager/src/pages/revenue-report.tsx` — the horizontal (`layout="vertical"`) bar chart under "الإيرادات حسب المنتج".

- Give each product bar a distinct color: render per-`Cell` fills cycling a small palette (e.g. 5–6 hsl values). Define the palette as a module constant.
- Add spacing between bars: set `barCategoryGap` (~`"30%"`) and a capped `barSize` on `<Bar>`.
- Reduce crowding of Arabic product names: bump `YAxis width` (e.g. 90 → 120) and add a small left `margin` on the `BarChart`.
- The 12-month trend chart is unchanged.

---

## 4. Tasheel (تسهيل) attribution + About page

- New page `artifacts/accounts-manager/src/pages/about.tsx`.
- New route in `artifacts/accounts-manager/src/App.tsx`: `<Route path="/about" component={About} />` — **public**, NOT wrapped in `AuthGuard`, so it is reachable from the login screen.
- About page content (Arabic, RTL): a title, a short blurb that the application is developed by **تسهيل (Tasheel)**, and a text link "تم التطوير بواسطة تسهيل" → `https://abdullamattar.github.io/Tasheel/` (`target="_blank"`, `rel="noopener noreferrer"`). No image assets.
- Login page (`login.tsx`): a small "تم التطوير بواسطة تسهيل" footer link under the card linking to `/about`.
- In-app: a footer link to `/about` in `layout.tsx` (sidebar bottom, below the user/logout block), shown for all roles.
- New display strings added to `artifacts/accounts-manager/src/lib/strings.ts`.

---

## Out of scope / non-goals
- No DB migration (hard delete uses existing tables; no new columns).
- No change to the trend chart.
- No Tasheel logo/image assets.
- No change to suspend/unsuspend behavior beyond the 403 status code.

## Testing
- Backend: delete route removes all child rows for a non-demo org and refuses demo org; suspended login returns 403 with the suspended message.
- Frontend: suspended login shows the dedicated banner; bad credentials still show the generic error; delete button confirms then removes the org from the table; revenue chart bars are colored and spaced; About page reachable at `/about` from login and from in-app footer.
