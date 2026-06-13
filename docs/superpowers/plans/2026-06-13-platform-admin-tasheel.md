# Platform Admin + Tasheel Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the platform superadmin hard-delete organizations, fix the broken suspended-account login banner, declutter the revenue-by-product chart, and add Tasheel (تسهيل) attribution plus a public About page.

**Architecture:** Express 5 + Drizzle/better-sqlite3 API (`artifacts/api-server`) and a React + Vite + wouter SPA (`artifacts/accounts-manager`) in a pnpm monorepo. Platform routes are superadmin-guarded. The SPA has two API clients: the generated `@workspace/api-client-react` (throws `ApiError` with `.data`/`.status`) used by auth, and a local `request()` helper in `phase3-api.ts` (throws `Error(text)`) used by platform/report calls.

**Tech Stack:** TypeScript, Express 5, drizzle-orm, better-sqlite3, React 18, wouter, @tanstack/react-query, Radix UI, recharts, Tailwind.

> **No automated test harness exists in this repo** (no vitest/jest/playwright). Per-task verification uses `pnpm --filter <pkg> run typecheck` (and a build where relevant) plus a targeted manual runtime check. Do not introduce a test framework. Run all commands from the repo root `D:/Abdulla/SharedAccManager` in PowerShell.

---

## File Structure

- `artifacts/api-server/src/routes/platform.ts` — MODIFY: add `DELETE /platform/orgs/:id` (cascade delete + audit).
- `artifacts/api-server/src/routes/auth.ts` — MODIFY: suspended-org rejection 401 → 403.
- `artifacts/accounts-manager/src/lib/phase3-api.ts` — MODIFY: add `useDeleteOrg` hook.
- `artifacts/accounts-manager/src/pages/platform.tsx` — MODIFY: add delete button + confirm dialog.
- `artifacts/accounts-manager/src/pages/login.tsx` — MODIFY: fix error-shape read, add suspended banner, add Tasheel footer link.
- `artifacts/accounts-manager/src/pages/revenue-report.tsx` — MODIFY: per-bar colors + spacing.
- `artifacts/accounts-manager/src/pages/about.tsx` — CREATE: About / Tasheel page.
- `artifacts/accounts-manager/src/App.tsx` — MODIFY: add public `/about` route.
- `artifacts/accounts-manager/src/components/layout.tsx` — MODIFY: add About footer link.
- `artifacts/accounts-manager/src/lib/strings.ts` — MODIFY: add platform/about/auth strings.

---

## Task 1: Backend — DELETE organization route

**Files:**
- Modify: `artifacts/api-server/src/routes/platform.ts`

- [ ] **Step 1: Add the delete route**

In `platform.ts`, after the existing `router.post(".../unsuspend", ...)` line (currently line 103) and before `export default router;`, insert:

```ts
router.delete("/platform/orgs/:id", async (req: Request, res: Response): Promise<void> => {
  const params = idParamsSchema.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: validationError(params.error) });
    return;
  }
  const orgId = params.data.id;
  if (orgId === DEMO_ORG_ID) {
    res.status(400).json({ error: "لا يمكن حذف النشاط التجريبي" });
    return;
  }

  const actor = getRequestUser(req);
  const deletedName = db.transaction((tx) => {
    const organization = tx.select({ name: organizationsTable.name })
      .from(organizationsTable)
      .where(eq(organizationsTable.id, orgId))
      .get();
    if (!organization) return null;

    const orgUserIds = tx.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.orgId, orgId))
      .all()
      .map((u) => u.id);

    // Delete children first (foreign_keys = ON). accounts cascades to slots.
    tx.delete(paymentsTable).where(eq(paymentsTable.orgId, orgId)).run();
    tx.delete(subscriptionsTable).where(eq(subscriptionsTable.orgId, orgId)).run();
    tx.delete(accountsTable).where(eq(accountsTable.orgId, orgId)).run();
    tx.delete(productsTable).where(eq(productsTable.orgId, orgId)).run();
    tx.delete(customersTable).where(eq(customersTable.orgId, orgId)).run();
    tx.delete(settingsTable).where(eq(settingsTable.orgId, orgId)).run();
    if (orgUserIds.length > 0) {
      tx.delete(auditLogTable)
        .where(or(eq(auditLogTable.orgId, orgId), inArray(auditLogTable.userId, orgUserIds)))
        .run();
    } else {
      tx.delete(auditLogTable).where(eq(auditLogTable.orgId, orgId)).run();
    }
    tx.delete(usersTable).where(eq(usersTable.orgId, orgId)).run();
    tx.delete(organizationsTable).where(eq(organizationsTable.id, orgId)).run();

    tx.insert(auditLogTable).values({
      userId: actor.id,
      orgId: null,
      action: "platform_delete_org",
      entity: "organization",
      entityId: orgId,
      detail: `حذف النشاط: ${organization.name}`,
    }).run();
    return organization.name;
  });

  if (!deletedName) {
    res.status(404).json({ error: "النشاط غير موجود" });
    return;
  }
  res.json({ ok: true });
});
```

- [ ] **Step 2: Add the missing imports**

In `platform.ts`, the drizzle import (line 15) is currently:
```ts
import { and, asc, eq, min, sql } from "drizzle-orm";
```
Replace it with (adds `or`, `inArray`; `settingsTable` must also be imported from `@workspace/db`):
```ts
import { and, asc, eq, inArray, min, or, sql } from "drizzle-orm";
```
Then in the `@workspace/db` import block (lines 2–14) add `settingsTable,` to the list (it is not currently imported). The other tables used (`paymentsTable`, `subscriptionsTable`, `accountsTable`, `productsTable`, `customersTable`, `auditLogTable`, `usersTable`, `organizationsTable`) are already imported.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS (no errors). If `settingsTable` is not exported from `@workspace/db`, confirm its export name in `lib/db/src/schema/index.ts` and use that name.

- [ ] **Step 4: Runtime sanity check (build the server)**

Run: `pnpm --filter @workspace/api-server run build`
Expected: build succeeds, emits `artifacts/api-server/dist/index.mjs`.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/routes/platform.ts
git commit -m "feat(platform): add DELETE /platform/orgs/:id hard-delete route"
```

---

## Task 2: Backend — suspended login returns 403

**Files:**
- Modify: `artifacts/api-server/src/routes/auth.ts:57-60`

- [ ] **Step 1: Change the status code**

In `auth.ts`, the suspended-org block currently reads:
```ts
  if (row.orgId != null && row.orgStatus === "suspended") {
    res.status(401).json({ error: getSuspendedOrgError() });
    return;
  }
```
Change `401` to `403`:
```ts
  if (row.orgId != null && row.orgStatus === "suspended") {
    res.status(403).json({ error: getSuspendedOrgError() });
    return;
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/api-server run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/auth.ts
git commit -m "fix(auth): return 403 (not 401) for suspended-org login so client can distinguish it"
```

---

## Task 3: Frontend — delete-org hook + button with confirmation

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/phase3-api.ts` (near the `useSuspendOrg`/`useUnsuspendOrg` definitions, ~lines 89-93)
- Modify: `artifacts/accounts-manager/src/pages/platform.tsx`

- [ ] **Step 1: Add the `useDeleteOrg` hook**

In `phase3-api.ts`, immediately after the `useUnsuspendOrg` definition (currently lines 92-93), add:
```ts
export const useDeleteOrg = () => useMutation({
  mutationFn: ({ id }: { id: number }) => request(`/api/platform/orgs/${id}`, { method: "DELETE" }),
});
```

- [ ] **Step 2: Wire delete into the platform page**

In `platform.tsx`:

(a) Update the imports at the top:
```ts
import { usePlatformOrgs, useSuspendOrg, useUnsuspendOrg, useDeleteOrg } from "@/lib/phase3-api";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
```

(b) Inside the component, after `const unsuspend = useUnsuspendOrg();` add:
```ts
  const remove = useDeleteOrg();
```
and after the existing `updateStatus` function add:
```ts
  const deleteOrg = (id: number) => {
    remove.mutate({ id }, {
      onSuccess: reload,
      onError: () => toast({ title: "تعذر حذف النشاط", variant: "destructive" }),
    });
  };
```

(c) Replace the الإجراءات `<TableCell>` body (currently lines 68-81, the `org.id === 1 ? (...) : (<Button.../>)` block) with:
```tsx
                  <TableCell>
                    {org.id === 1 ? (
                      <span className="text-xs text-muted-foreground">النشاط التجريبي محمي</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant={org.status === "active" ? "destructive" : "outline"}
                          size="sm"
                          onClick={() => updateStatus(org.id, org.status === "active")}
                          disabled={suspend.isPending || unsuspend.isPending}
                        >
                          {org.status === "active" ? "تعليق" : "إعادة تفعيل"}
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" disabled={remove.isPending}>
                              حذف
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>حذف النشاط نهائياً؟</AlertDialogTitle>
                              <AlertDialogDescription>
                                {`سيتم حذف "${org.name}" وكل بياناته (المستخدمون والمنتجات والحسابات والعملاء والاشتراكات والمدفوعات) نهائياً. لا يمكن التراجع عن هذا الإجراء.`}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>إلغاء</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteOrg(org.id)}
                                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                              >
                                حذف
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    )}
                  </TableCell>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/accounts-manager run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual runtime check**

Start the app (`./RUN_APP.cmd` or the project's run flow), log in as the superadmin (platform admin), open `إدارة المنصة`. For a non-demo org, click حذف → confirm dialog appears → confirm → the row disappears and counts reflect removal. Demo org (#1) shows "النشاط التجريبي محمي" with no حذف button.

- [ ] **Step 5: Commit**

```bash
git add artifacts/accounts-manager/src/lib/phase3-api.ts artifacts/accounts-manager/src/pages/platform.tsx
git commit -m "feat(platform): delete-org button with confirmation dialog"
```

---

## Task 4: Frontend — fix login error message + suspended banner

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`
- Modify: `artifacts/accounts-manager/src/pages/login.tsx`

- [ ] **Step 1: Add suspended-banner strings**

In `strings.ts`, inside the `auth: { ... }` object (after `registerError` on line 19), add:
```ts
    suspendedTitle: "الحساب موقوف",
```

- [ ] **Step 2: Fix the error-shape read and track the status**

In `login.tsx`, the `onAuthError` function (currently lines 57-61) reads `err?.response?.data?.error`. The generated client throws `ApiError` whose body is on `err.data`. Replace the function and add a status-tracking state.

Add to the component state (near the other `useState` calls, after `const [error, setError] = useState<string | null>(null);` on line 25):
```ts
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
```

Replace `onAuthError` (lines 57-61) with:
```ts
  const onAuthError = (err: any, fallback: string) => {
    const msg = err?.data?.error || err?.response?.data?.error || fallback;
    setError(msg);
    setErrorStatus(typeof err?.status === "number" ? err.status : null);
    toast({ title: msg, variant: "destructive" });
  };
```

In `handleSubmit`, reset the status alongside the error — change `setError(null);` (line 65) to:
```ts
    setError(null);
    setErrorStatus(null);
```

- [ ] **Step 3: Render a distinct suspended banner**

In `login.tsx`, update the lucide import (line 12) to include `ShieldAlert`:
```ts
import { Loader2, Eye, EyeOff, AlertCircle, ShieldAlert } from "lucide-react";
```

Replace the existing error `Alert` block (currently lines 119-125):
```tsx
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{strings.app.error}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
```
with a version that shows a distinct suspended banner when the status is 403:
```tsx
            {error && errorStatus === 403 ? (
              <Alert className="border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                <ShieldAlert className="h-4 w-4" />
                <AlertTitle>{strings.auth.suspendedTitle}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : error ? (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>{strings.app.error}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/accounts-manager run typecheck`
Expected: PASS.

- [ ] **Step 5: Manual runtime check**

In the platform admin, suspend a test org. Log out, attempt to log in as that org's admin → the amber "الحساب موقوف" banner with the message "تم إيقاف حسابكم - يرجى التواصل مع الإدارة" appears (not the generic red error). Log in with a wrong password for an active account → the generic red "حدث خطأ غير متوقع / بيانات الاعتماد غير صحيحة" error still appears.

- [ ] **Step 6: Commit**

```bash
git add artifacts/accounts-manager/src/lib/strings.ts artifacts/accounts-manager/src/pages/login.tsx
git commit -m "fix(login): read ApiError body (err.data) and show distinct suspended banner"
```

---

## Task 5: Frontend — revenue-by-product chart colors + spacing

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/revenue-report.tsx`

- [ ] **Step 1: Add a color palette constant**

In `revenue-report.tsx`, after the imports (after line 8) add:
```ts
const PRODUCT_COLORS = [
  "hsl(221 83% 53%)",
  "hsl(142 71% 45%)",
  "hsl(38 92% 50%)",
  "hsl(280 65% 60%)",
  "hsl(0 72% 51%)",
  "hsl(199 89% 48%)",
];
```

- [ ] **Step 2: Apply colors + spacing to the product chart**

In the "Revenue by product" `BarChart` block (currently lines 136-148), replace it with a version that adds a left margin, wider Y axis, category gap, capped bar size, and per-`Cell` colors:
```tsx
                <BarChart
                  layout="vertical"
                  data={data?.products ?? []}
                  margin={{ left: 12, right: 12 }}
                  barCategoryGap="30%"
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="productName" width={120} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => [`${value} ${currency}`, strings.phase3.monthlyRevenue]}
                      />
                    }
                  />
                  <Bar dataKey="revenue" radius={[0, 4, 4, 0]} maxBarSize={28}>
                    {(data?.products ?? []).map((entry, index) => (
                      <Cell key={entry.productId} fill={PRODUCT_COLORS[index % PRODUCT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
```
(`Cell` is already imported on line 6. The `<ChartContainer>` wrapper and `dir="ltr"` div around it are unchanged.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/accounts-manager run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual runtime check**

As an org admin with several products and payments, open the revenue report. The "الإيرادات حسب المنتج" bars are each a different color, are not cramped, and long Arabic product names fit on the Y axis.

- [ ] **Step 5: Commit**

```bash
git add artifacts/accounts-manager/src/pages/revenue-report.tsx
git commit -m "style(revenue): distinct colors and spacing for revenue-by-product chart"
```

---

## Task 6: Frontend — About page + Tasheel attribution

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/strings.ts`
- Create: `artifacts/accounts-manager/src/pages/about.tsx`
- Modify: `artifacts/accounts-manager/src/App.tsx`
- Modify: `artifacts/accounts-manager/src/pages/login.tsx`
- Modify: `artifacts/accounts-manager/src/components/layout.tsx`

- [ ] **Step 1: Add about/attribution strings**

In `strings.ts`, add a new top-level section (after the `notFound` block, before `auth`, keeping valid object syntax):
```ts
  about: {
    title: "حول التطبيق",
    poweredBy: "تم التطوير بواسطة تسهيل",
    description: "تم تطوير هذا التطبيق بواسطة تسهيل (Tasheel)، فريق يبني أدوات لتسهيل إدارة الأعمال.",
    visit: "زيارة موقع تسهيل",
    url: "https://abdullamattar.github.io/Tasheel/",
    back: "العودة",
  },
```

- [ ] **Step 2: Create the About page**

Create `artifacts/accounts-manager/src/pages/about.tsx`:
```tsx
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { strings } from "@/lib/strings";

export default function About() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">{strings.about.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{strings.about.description}</p>
          <a
            href={strings.about.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-medium text-primary underline underline-offset-4"
          >
            {strings.about.poweredBy}
          </a>
          <div>
            <Button asChild variant="outline" className="w-full">
              <Link href="/login">{strings.about.back}</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Register the public route**

In `App.tsx`, add the import next to the other page imports (after `import Login from "@/pages/login";` on line 8):
```ts
import About from "@/pages/about";
```
In the `<Switch>` (inside `Router`), add a public route right after the `/login` route (line 32) — NOT wrapped in `AuthGuard`:
```tsx
      <Route path="/about" component={About} />
```

- [ ] **Step 4: Add the Tasheel footer link to the login page**

In `login.tsx`, add `Link` to the wouter import (line 2 currently `import { useLocation } from "wouter";`):
```ts
import { useLocation, Link } from "wouter";
```
Then add a footer link just inside the closing `</Card>` — place it after the `</CardContent>` (currently line 254) and before `</Card>` (line 255):
```tsx
          <div className="pb-4 text-center">
            <Link href="/about" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
              {strings.about.poweredBy}
            </Link>
          </div>
```

- [ ] **Step 5: Add the About link to the in-app layout footer**

In `layout.tsx`, add `Info` to the lucide import (line 6) and ensure `Link` is imported (it already is, line 1). Then in the sidebar footer `<div className="p-4 border-t border-border">` block (lines 71-84), add an About link below the logout `<Button>` (after the closing `</Button>` on line 83, still inside that footer div):
```tsx
        <Link href="/about" className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground hover:text-foreground" data-testid="nav-about">
          <Info className="h-3.5 w-3.5" />
          <span>{strings.about.poweredBy}</span>
        </Link>
```
Update the lucide import line 6 to include `Info`:
```ts
import { Package, LogOut, Menu, UserRound, ReceiptText, ShoppingCart, LayoutDashboard, CalendarClock, Settings, ShieldCheck, Loader2, Info } from "lucide-react";
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @workspace/accounts-manager run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual runtime check**

- From the login screen, click "تم التطوير بواسطة تسهيل" → navigates to `/about` while logged out (no redirect to login). The "زيارة موقع تسهيل"/poweredBy link opens `https://abdullamattar.github.io/Tasheel/` in a new tab; "العودة" returns to login.
- Logged in (any role), the sidebar footer shows the About link → opens `/about`.

- [ ] **Step 8: Commit**

```bash
git add artifacts/accounts-manager/src/lib/strings.ts artifacts/accounts-manager/src/pages/about.tsx artifacts/accounts-manager/src/App.tsx artifacts/accounts-manager/src/pages/login.tsx artifacts/accounts-manager/src/components/layout.tsx
git commit -m "feat(about): Tasheel attribution and public About page"
```

---

## Final verification

- [ ] **Full workspace typecheck**

Run: `pnpm run typecheck`
Expected: PASS across all packages.

- [ ] **Build**

Run: `pnpm run build`
Expected: PASS (server + client build).

---

## Notes for the implementer
- `settingsTable` (Task 1, Step 2): confirm the exact export name in `lib/db/src/schema/index.ts` before use; the schema file is `lib/db/src/schema/settings.ts`.
- The platform routes (`phase3-api.request`) throw `Error(text)`, not `ApiError`; the delete error toast in Task 3 is generic and does not parse the body — that is intentional and matches the existing suspend/unsuspend error handling.
- Deployment is unchanged; no DB migration. After merge, redeploy follows the normal GitHub Actions → ghcr.io → `az containerapp update` pipeline (see project memory).
