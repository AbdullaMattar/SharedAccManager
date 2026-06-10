# Quality & UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve UX on the New Sale page (wizard) and Dashboard, fix code quality issues (N+1, LIKE escaping, dead deps, login bugs), and remove repo clutter.

**Architecture:** Backend changes are isolated to individual route files and one schema file. Frontend changes are page-level rewrites/edits. No database migrations, no auth changes, no new packages (except the Skeleton component already ships with shadcn).

**Tech Stack:** Express 5, Drizzle ORM + better-sqlite3, React + Vite + Tailwind + shadcn/ui, Wouter, TanStack Query, TypeScript 5.9, pnpm workspaces.

> **Note:** This project has zero test files. All verification steps are manual (start dev server, observe behavior). TDD steps are replaced with "implement → start server → verify" cycles.

---

## File Map

| File | Change |
|------|--------|
| `artifacts/api-server/src/app.ts` | Remove duplicate `/api/healthz` handler (line 42) |
| `artifacts/api-server/package.json` | Remove `jsonwebtoken`, `@types/jsonwebtoken`; move `@types/bcryptjs` to devDependencies |
| `artifacts/api-server/src/routes/customers.ts` | Escape `%`, `_`, `\` in LIKE search |
| `artifacts/api-server/src/routes/accounts.ts` | Replace N+1 slot queries with single grouped query |
| `artifacts/api-server/src/routes/dashboard.ts` | Add `totalSlots` to `freeSlotsByProduct` query |
| `artifacts/api-server/src/routes/stats.ts` | Read `offset` from query params, apply to audit log query |
| `lib/db/src/schema/phase3-validation.ts` | Add `offset` field to `auditQuerySchema` |
| `artifacts/accounts-manager/src/lib/phase3-api.ts` | Add `offset` param to `useListAdminAuditLog`; add `totalSlots` to `DashboardData` type |
| `artifacts/accounts-manager/src/pages/login.tsx` | Move redirect to `useEffect`, fix target to `/`, remove `window.location.href`, add `autocomplete` |
| `artifacts/accounts-manager/src/lib/auth.tsx` | Replace `user: any` with derived type from `useGetMe` |
| `artifacts/accounts-manager/src/pages/dashboard.tsx` | Full rewrite: renewal alert card, overdue renew button, capacity bar, skeleton, total links |
| `artifacts/accounts-manager/src/pages/audit.tsx` | Add page-based pagination with prev/next |
| `artifacts/accounts-manager/src/pages/new-sale.tsx` | Full rewrite: 5-step wizard with progress indicator |

---

## Task 1: Remove duplicate healthz + fix dead dependencies

**Files:**
- Modify: `artifacts/api-server/src/app.ts`
- Modify: `artifacts/api-server/package.json`

- [ ] **Step 1: Remove the duplicate healthz route in app.ts**

Open `artifacts/api-server/src/app.ts`. Delete line 42 exactly:
```ts
app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
```
After deletion, lines 42-44 should look like:
```ts
app.use("/api", router);

const publicDir = path.resolve(process.cwd(), "public");
```

- [ ] **Step 2: Remove dead dependencies from package.json**

In `artifacts/api-server/package.json`:

Remove from `"dependencies"`:
- `"jsonwebtoken": "^9.0.3"`
- `"@types/jsonwebtoken": "^9.0.10"`
- `"@types/bcryptjs": "^3.0.0"`

Add to `"devDependencies"` (after `"@types/cookie-parser"`):
- `"@types/bcryptjs": "^3.0.0"`

The final `dependencies` block (relevant lines):
```json
"dependencies": {
  "@workspace/api-zod": "workspace:*",
  "@workspace/db": "workspace:*",
  "bcryptjs": "^3.0.3",
  "better-sqlite3": "^12.10.0",
  "cookie-parser": "^1.4.7",
  "cors": "^2.8.6",
  "drizzle-orm": "catalog:",
  "express": "^5.2.1",
  "node-cron": "^4.2.1",
  "pino": "^9.14.0",
  "pino-http": "^10.5.0"
}
```

The final `devDependencies` block:
```json
"devDependencies": {
  "@types/bcryptjs": "^3.0.0",
  "@types/cookie-parser": "^1.4.10",
  "@types/cors": "^2.8.19",
  "@types/better-sqlite3": "^7.6.13",
  "@types/express": "^5.0.6",
  "@types/node": "catalog:",
  "esbuild": "0.27.3",
  "esbuild-plugin-pino": "^2.3.3",
  "pino-pretty": "^13.1.3",
  "thread-stream": "3.1.0"
}
```

- [ ] **Step 3: Reinstall and typecheck**

```
pnpm install
pnpm run typecheck
```
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```
git add artifacts/api-server/src/app.ts artifacts/api-server/package.json pnpm-lock.yaml
git commit -m "fix: remove duplicate healthz handler and dead jwt/types deps"
```

---

## Task 2: Fix LIKE wildcards in customer search

**Files:**
- Modify: `artifacts/api-server/src/routes/customers.ts`

- [ ] **Step 1: Add escapeLike helper and update the search query**

In `artifacts/api-server/src/routes/customers.ts`, replace the two import lines at the top with (note: remove `like` and `or`, keep `sql`):

```ts
import { asc, desc, eq, sql } from "drizzle-orm";
```

Add the escape helper immediately after the `isUniquePhoneError` function (after line 29):

```ts
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, "\\$&");
}
```

In the `GET /customers` handler, replace the `where` clause:

Old:
```ts
const search = parsed.data.q ? `%${parsed.data.q}%` : undefined;
const customers = await db
  .select()
  .from(customersTable)
  .where(
    search
      ? or(
          like(customersTable.name, search),
          like(customersTable.phone, search),
        )
      : undefined,
  )
  .orderBy(asc(customersTable.name));
```

New:
```ts
const search = parsed.data.q ? `%${escapeLike(parsed.data.q)}%` : undefined;
const customers = await db
  .select()
  .from(customersTable)
  .where(
    search
      ? sql`(${customersTable.name} LIKE ${search} ESCAPE '\\' OR ${customersTable.phone} LIKE ${search} ESCAPE '\\')`
      : undefined,
  )
  .orderBy(asc(customersTable.name));
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add artifacts/api-server/src/routes/customers.ts
git commit -m "fix: escape LIKE wildcards in customer search"
```

---

## Task 3: Fix N+1 query on accounts list

**Files:**
- Modify: `artifacts/api-server/src/routes/accounts.ts`

- [ ] **Step 1: Update imports**

In `artifacts/api-server/src/routes/accounts.ts`, change the drizzle-orm import line from:
```ts
import { eq, and, sql } from "drizzle-orm";
```
to:
```ts
import { eq, and, sql, inArray } from "drizzle-orm";
```

- [ ] **Step 2: Replace the N+1 loop in GET /accounts**

Find the block starting at `const accountsWithSlots = await Promise.all(` (currently lines 69-76). Replace the entire block with:

```ts
  const accountIds = accounts.map((a) => a.id);
  const allSlots = accountIds.length
    ? await db
        .select()
        .from(slotsTable)
        .where(inArray(slotsTable.accountId, accountIds))
        .orderBy(slotsTable.accountId, slotsTable.slotIndex)
    : [];

  const slotsByAccount = new Map<number, (typeof slotsTable.$inferSelect)[]>();
  for (const slot of allSlots) {
    const group = slotsByAccount.get(slot.accountId) ?? [];
    group.push(slot);
    slotsByAccount.set(slot.accountId, group);
  }

  const accountsWithSlots = accounts.map((a) => {
    const slots = slotsByAccount.get(a.id) ?? [];
    return {
      ...a,
      slots,
      freeSlots: slots.filter((s) => s.status === "free").length,
      occupiedSlots: slots.filter((s) => s.status === "occupied").length,
    };
  });
```

- [ ] **Step 3: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```
git add artifacts/api-server/src/routes/accounts.ts
git commit -m "perf: replace N+1 slot queries with single grouped query on accounts list"
```

---

## Task 4: Add totalSlots to dashboard backend

**Files:**
- Modify: `artifacts/api-server/src/routes/dashboard.ts`

- [ ] **Step 1: Update the freeSlotsByProduct query**

In `artifacts/api-server/src/routes/dashboard.ts`, find the `freeSlotsByProduct` query (inside `Promise.all`, the second item). Replace it entirely:

Old:
```ts
    db
      .select({
        productId: productsTable.id,
        productName: productsTable.name,
        freeSlots: sql<number>`count(${slotsTable.id})`,
      })
      .from(productsTable)
      .leftJoin(accountsTable, eq(accountsTable.productId, productsTable.id))
      .leftJoin(
        slotsTable,
        and(eq(slotsTable.accountId, accountsTable.id), eq(slotsTable.status, "free")),
      )
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.name)),
```

New:
```ts
    db
      .select({
        productId: productsTable.id,
        productName: productsTable.name,
        freeSlots: sql<number>`count(case when ${slotsTable.status} = 'free' then 1 end)`,
        totalSlots: sql<number>`count(${slotsTable.id})`,
      })
      .from(productsTable)
      .leftJoin(
        accountsTable,
        and(
          eq(accountsTable.productId, productsTable.id),
          eq(accountsTable.status, "active"),
        ),
      )
      .leftJoin(slotsTable, eq(slotsTable.accountId, accountsTable.id))
      .groupBy(productsTable.id)
      .orderBy(asc(productsTable.name)),
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add artifacts/api-server/src/routes/dashboard.ts
git commit -m "feat: add totalSlots to dashboard freeSlotsByProduct query"
```

---

## Task 5: Add offset pagination to audit log backend

**Files:**
- Modify: `lib/db/src/schema/phase3-validation.ts`
- Modify: `artifacts/api-server/src/routes/stats.ts`

- [ ] **Step 1: Add offset to auditQuerySchema**

In `lib/db/src/schema/phase3-validation.ts`, find the `auditQuerySchema` definition and add `offset`:

Old:
```ts
export const auditQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
```

New:
```ts
export const auditQuerySchema = z.object({
  action: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});
```

- [ ] **Step 2: Apply offset in the stats route**

In `artifacts/api-server/src/routes/stats.ts`, update the audit-log handler. Find the block that reads `limit` and builds the query. Replace from the `const limit =` line through the `.limit(limit);` line:

Old:
```ts
  const queryParsed = ListAuditLogQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 50) : 50;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;

  const entries = await db
    .select({
      id: auditLogTable.id,
      userId: auditLogTable.userId,
      userName: usersTable.name,
      action: auditLogTable.action,
      entity: auditLogTable.entity,
      entityId: auditLogTable.entityId,
      detail: auditLogTable.detail,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.userId, usersTable.id))
    .where(action ? eq(auditLogTable.action, action) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
```

New:
```ts
  const queryParsed = ListAuditLogQueryParams.safeParse(req.query);
  const limit = queryParsed.success ? (queryParsed.data.limit ?? 100) : 100;
  const offset = typeof req.query.offset === "string" ? Math.max(0, Number(req.query.offset) || 0) : 0;
  const action = typeof req.query.action === "string" ? req.query.action : undefined;

  const entries = await db
    .select({
      id: auditLogTable.id,
      userId: auditLogTable.userId,
      userName: usersTable.name,
      action: auditLogTable.action,
      entity: auditLogTable.entity,
      entityId: auditLogTable.entityId,
      detail: auditLogTable.detail,
      createdAt: auditLogTable.createdAt,
    })
    .from(auditLogTable)
    .leftJoin(usersTable, eq(auditLogTable.userId, usersTable.id))
    .where(action ? eq(auditLogTable.action, action) : undefined)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit)
    .offset(offset);
```

- [ ] **Step 3: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```
git add lib/db/src/schema/phase3-validation.ts artifacts/api-server/src/routes/stats.ts
git commit -m "feat: add offset pagination to audit log endpoint"
```

---

## Task 6: Fix login page

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/login.tsx`

- [ ] **Step 1: Rewrite login.tsx**

Replace the entire file content:

```tsx
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { strings } from "@/lib/strings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const loginMutation = useLogin();
  const { isAuthenticated, isLoading } = useAuth();

  useEffect(() => {
    if (isAuthenticated) setLocation("/");
  }, [isAuthenticated, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate(
      { data: { email, password } },
      {
        onSuccess: () => {
          toast({ title: strings.auth.loginSuccess });
          setLocation("/");
        },
        onError: () => {
          toast({ title: strings.auth.loginError, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md" data-testid="card-login">
        <CardHeader className="space-y-2 text-center">
          <CardTitle className="text-2xl font-bold">{strings.app.title}</CardTitle>
          <CardDescription>{strings.app.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{strings.auth.email}</Label>
              <Input
                id="email"
                type="email"
                placeholder={strings.auth.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                dir="ltr"
                className="text-start"
                autoComplete="email"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{strings.auth.password}</Label>
              <Input
                id="password"
                type="password"
                placeholder={strings.auth.passwordPlaceholder}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                dir="ltr"
                className="text-start"
                autoComplete="current-password"
                data-testid="input-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              data-testid="button-submit-login"
            >
              {loginMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                strings.auth.login
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add artifacts/accounts-manager/src/pages/login.tsx
git commit -m "fix: login redirect to dashboard, remove double navigate, add autocomplete"
```

---

## Task 7: Fix auth context type

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/auth.tsx`

- [ ] **Step 1: Replace `user: any` with derived type**

Replace the entire file:

```tsx
import { useGetMe } from "@workspace/api-client-react";
import { createContext, useContext, ReactNode } from "react";

type MeData = NonNullable<ReturnType<typeof useGetMe>["data"]>;

interface AuthContextType {
  user: MeData | undefined;
  isLoading: boolean;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: undefined,
  isLoading: true,
  isAuthenticated: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: user, isLoading, isError } = useGetMe({
    query: {
      retry: 1,
      retryDelay: 1500,
      refetchOnWindowFocus: false,
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isLoading && !isError,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0. If there are type errors because `user.role` is now typed and some code passed it as `any`, fix those call sites to use the proper property access.

- [ ] **Step 3: Commit**

```
git add artifacts/accounts-manager/src/lib/auth.tsx
git commit -m "fix: replace user:any in auth context with inferred useGetMe type"
```

---

## Task 8: Update phase3-api.ts (offset + totalSlots types)

**Files:**
- Modify: `artifacts/accounts-manager/src/lib/phase3-api.ts`

- [ ] **Step 1: Add totalSlots to DashboardData type and offset to useListAdminAuditLog**

Replace the entire file content:

```ts
import {
  useMutation, useQuery
} from "@tanstack/react-query";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) throw new Error(await response.text());
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => value !== undefined && params.set(key, String(value)));
  return params.size ? `?${params}` : "";
};

export type ExpiringSubscription = { id: number; customerName: string; phone: string; whatsapp?: string | null; productName: string; accountLabel: string; expiryDate: string; daysRemaining: number; price: number; defaultDurationDays: number };
export type DashboardData = {
  expiringCounts: { oneDay: number; threeDays: number; sevenDays: number };
  overdue: ExpiringSubscription[];
  freeSlots: { productId: number; productName: string; freeCount: number; totalSlots: number }[];
  totals: { activeSubscriptions: number; totalAccounts: number; monthlyRevenue: number };
  currency?: string;
  businessName?: string;
};
export type Settings = { reminderLeadDays: number; reminderRecipient: "staff" | "customer" | "both"; graceDays: number; businessName: string; currency: string };
export type AdminUser = { id: number; name: string; email: string; role: "admin" | "staff"; enabled: boolean };
export type AuditEntry = { id: number; userName?: string | null; action: string; entityType: string; entityId?: number | null; createdAt: string };
export type RevenueReport = { total: number; currency?: string; products: { productId: number; productName: string; revenue: number; paymentsCount?: number }[] };

type RawSubscription = { id: number; customerName: string; customerPhone: string; customerWhatsapp?: string | null; productName: string; accountLabel: string; expiryDate: string; price: number; productDefaultDurationDays: number };
const normalizeSubscription = (item: RawSubscription): ExpiringSubscription => ({
  ...item, phone: item.customerPhone, whatsapp: item.customerWhatsapp, defaultDurationDays: item.productDefaultDurationDays,
  daysRemaining: Math.ceil((new Date(`${item.expiryDate}T23:59:59`).getTime() - Date.now()) / 86400000),
});

export const useGetDashboard = () => useQuery({ queryKey: ["phase3", "dashboard"], queryFn: async () => {
  const raw = await request<any>("/api/dashboard");
  return {
    expiringCounts: { oneDay: raw.expiringCounts["1"] || 0, threeDays: raw.expiringCounts["3"] || 0, sevenDays: raw.expiringCounts["7"] || 0 },
    overdue: raw.overdue.map(normalizeSubscription),
    freeSlots: raw.freeSlotsByProduct.map((item: any) => ({ ...item, freeCount: item.freeSlots })),
    totals: raw.totals,
    currency: raw.settings.currency,
    businessName: raw.settings.businessName,
  } as DashboardData;
} });

export const useListExpiringSubscriptions = (days?: number) => useQuery({ queryKey: ["phase3", "expiring", days], queryFn: async () => {
  const raw = await request<{ subscriptions: RawSubscription[] }>(`/api/expiring${query({ days })}`);
  return raw.subscriptions.map(normalizeSubscription);
} });

export const useRenewSubscription = () => useMutation({ mutationFn: ({ id, data }: { id: number; data: { durationDays: number; price: number; paymentMethod: string; notes?: string } }) => request(`/api/subscriptions/${id}/renew`, { method: "POST", body: JSON.stringify({ ...data, paidAt: new Date().toISOString() }) }) });
export const useGetSettings = () => useQuery({ queryKey: ["phase3", "settings"], queryFn: () => request<Settings>("/api/settings") });
export const useUpdateSettings = () => useMutation({ mutationFn: (data: Settings) => request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify({ reminder_lead_days: data.reminderLeadDays, reminder_recipient: data.reminderRecipient, grace_days: data.graceDays, business_name: data.businessName, currency: data.currency }) }) });

const normalizeUser = (user: any): AdminUser => ({ ...user, enabled: !user.disabled });
export const useListUsers = () => useQuery({ queryKey: ["phase3", "users"], queryFn: async () => (await request<any[]>("/api/users")).map(normalizeUser) });
export const useCreateUser = () => useMutation({ mutationFn: async ({ enabled: _enabled, ...data }: Omit<AdminUser, "id"> & { password: string }) => normalizeUser(await request<AdminUser>("/api/users", { method: "POST", body: JSON.stringify(data) })) });
export const useUpdateUser = () => useMutation({ mutationFn: async ({ id, data }: { id: number; data: Partial<AdminUser> }) => {
  const { enabled, ...rest } = data; return normalizeUser(await request<AdminUser>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ ...rest, ...(enabled === undefined ? {} : { disabled: !enabled }) }) }));
} });
export const useResetUserPassword = () => useMutation({ mutationFn: ({ id, password }: { id: number; password: string }) => request(`/api/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }) });

export const useListAdminAuditLog = (action?: string, offset?: number) => useQuery({
  queryKey: ["phase3", "audit", action, offset],
  queryFn: async () => (await request<any[]>(`/api/stats/audit-log${query({ action, offset })}`)).map((item) => ({ ...item, entityType: item.entity })) as AuditEntry[],
});

export const useGetRevenueReport = () => useQuery({ queryKey: ["phase3", "revenue"], queryFn: async () => { const raw = await request<any>("/api/reports/revenue"); return { total: raw.revenue, products: raw.byProduct, currency: raw.currency } as RevenueReport; } });
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add artifacts/accounts-manager/src/lib/phase3-api.ts
git commit -m "feat: add totalSlots type to DashboardData, add offset param to useListAdminAuditLog"
```

---

## Task 9: Rewrite dashboard frontend

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/dashboard.tsx`

- [ ] **Step 1: Rewrite dashboard.tsx**

Replace the entire file content:

```tsx
import { Link } from "wouter";
import { CalendarClock, CircleDollarSign, Layers3, UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RenewSubscriptionDialog } from "@/components/renew-subscription-dialog";
import { useGetDashboard } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

export default function Dashboard() {
  const { data, isLoading } = useGetDashboard();
  if (isLoading) return <DashboardSkeleton />;
  if (!data) return <p>{strings.app.noData}</p>;
  const currency = data.currency || strings.common.currency;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{data.businessName || strings.phase3.dashboard}</h1>
        <p className="text-sm text-muted-foreground">{strings.phase3.needsAction}</p>
      </div>

      {/* Renewal alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{strings.phase3.expiringSoon}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0 p-0 pb-2">
          {[
            { days: 1, label: strings.phase3.withinOneDay, count: data.expiringCounts.oneDay },
            { days: 3, label: strings.phase3.withinThreeDays, count: data.expiringCounts.threeDays },
            { days: 7, label: strings.phase3.withinSevenDays, count: data.expiringCounts.sevenDays },
          ].map(({ days, label, count }) => (
            <Link
              key={days}
              href={`/expiring?days=${days}`}
              className="flex items-center justify-between px-6 py-2.5 hover:bg-muted transition-colors"
            >
              <span className="text-sm">{label}</span>
              <span
                className={cn(
                  "font-bold tabular-nums",
                  count > 0 ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {count}
              </span>
            </Link>
          ))}
        </CardContent>
      </Card>

      {/* Quick totals */}
      <section>
        <h2 className="mb-3 font-bold">{strings.phase3.quickTotals}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href="/subscriptions" className="block">
            <TotalCard
              icon={UserCheck}
              label={strings.phase3.activeSubscriptions}
              value={data.totals.activeSubscriptions}
            />
          </Link>
          <Link href="/accounts" className="block">
            <TotalCard
              icon={Layers3}
              label={strings.phase3.totalAccounts}
              value={data.totals.totalAccounts}
            />
          </Link>
          <Link href="/reports/revenue" className="block">
            <TotalCard
              icon={CircleDollarSign}
              label={strings.phase3.monthlyRevenue}
              value={`${data.totals.monthlyRevenue} ${currency}`}
            />
          </Link>
        </div>
      </section>

      {/* Overdue + Free slots */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{strings.phase3.overdue}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.overdue.length ? (
              data.overdue.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border p-3"
                >
                  <Link
                    href={`/subscriptions/${item.id}`}
                    className="flex-1 min-w-0"
                  >
                    <strong className="block truncate">{item.customerName}</strong>
                    <small className="text-muted-foreground">
                      {item.productName} · {item.expiryDate}
                    </small>
                  </Link>
                  <span className="shrink-0 text-sm text-destructive">
                    {strings.phase3.daysRemaining(item.daysRemaining)}
                  </span>
                  <RenewSubscriptionDialog
                    id={item.id}
                    durationDays={item.defaultDurationDays}
                    price={item.price}
                    trigger={
                      <button className="shrink-0 rounded-md border px-2 py-1 text-xs hover:bg-muted transition-colors">
                        {strings.phase3.renew}
                      </button>
                    }
                  />
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">{strings.phase3.noOverdue}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{strings.phase3.freeSlots}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.freeSlots.map((item) => {
              const total = item.totalSlots ?? item.freeCount;
              const freePercent = total > 0 ? (item.freeCount / total) * 100 : 0;
              const barColor =
                freePercent > 50
                  ? "bg-green-500"
                  : freePercent > 20
                    ? "bg-amber-500"
                    : "bg-red-500";
              return (
                <Link
                  key={item.productId}
                  href={`/accounts?productId=${item.productId}`}
                  className="flex items-center gap-3 rounded-md bg-muted p-3 hover:bg-muted/70 transition-colors"
                >
                  <span className="flex-1 text-sm">{item.productName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="w-20 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", barColor)}
                        style={{ width: `${freePercent}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium tabular-nums">
                      {item.freeCount} / {total}
                    </span>
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TotalCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserCheck;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card className="hover:border-primary/50 transition-colors h-full">
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className="h-6 w-6 text-primary shrink-0" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <strong className="tabular-nums">{value}</strong>
        </div>
      </CardContent>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Card>
        <CardContent className="space-y-3 p-6">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-8" />
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid gap-3 sm:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <Card key={n}>
            <CardContent className="p-4">
              <Skeleton className="h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        {[1, 2].map((n) => (
          <Card key={n}>
            <CardContent className="space-y-2 p-6">
              {[1, 2, 3].map((m) => (
                <Skeleton key={m} className="h-12 w-full" />
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add artifacts/accounts-manager/src/pages/dashboard.tsx
git commit -m "feat: redesign dashboard - renewal alerts, capacity bars, overdue renew, skeleton"
```

---

## Task 10: Add pagination to audit page

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/audit.tsx`

- [ ] **Step 1: Rewrite audit.tsx with page-based pagination**

Replace the entire file content:

```tsx
import { useEffect, useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useListAdminAuditLog } from "@/lib/phase3-api";
import { strings } from "@/lib/strings";

const PAGE_SIZE = 100;

export default function Audit() {
  const [action, setAction] = useState("all");
  const [page, setPage] = useState(0);

  // Reset to page 0 when action filter changes
  useEffect(() => { setPage(0); }, [action]);

  const { data = [], isFetching } = useListAdminAuditLog(
    action === "all" ? undefined : action,
    page * PAGE_SIZE,
  );

  const hasNextPage = data.length === PAGE_SIZE;
  const hasPrevPage = page > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{strings.phase3.audit}</h1>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{strings.phase3.allActions}</SelectItem>
            {["sale", "renew", "credential_reveal", "settings_update", "user_create", "user_update", "user_password_reset", "subscription_cancel"].map((item) => (
              <SelectItem key={item} value={item}>{item}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        {data.length === 0 && !isFetching && (
          <p className="text-sm text-muted-foreground">{strings.app.noData}</p>
        )}
        {data.map((entry) => (
          <Card key={entry.id}>
            <CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-4">
              <Fact label={strings.phase3.who} value={entry.userName || "-"} />
              <Fact label={strings.phase3.action} value={entry.action} />
              <Fact
                label={strings.phase3.entity}
                value={`${entry.entityType}${entry.entityId ? ` #${entry.entityId}` : ""}`}
              />
              <Fact label={strings.phase3.when} value={entry.createdAt} />
            </CardContent>
          </Card>
        ))}
      </div>

      {(hasPrevPage || hasNextPage) && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={!hasPrevPage || isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronRight className="h-4 w-4 me-1" />
            السابق
          </Button>
          <span className="text-sm text-muted-foreground">صفحة {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage || isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            التالي
            <ChevronLeft className="h-4 w-4 ms-1" />
          </Button>
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-muted-foreground">{label}</span>
      {value}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```
git add artifacts/accounts-manager/src/pages/audit.tsx
git commit -m "feat: add page-based pagination to audit log"
```

---

## Task 11: Rewrite New Sale as a 5-step wizard

**Files:**
- Modify: `artifacts/accounts-manager/src/pages/new-sale.tsx`

- [ ] **Step 1: Rewrite new-sale.tsx**

Replace the entire file content:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Check, CheckCircle2, Loader2, Plus, Search, ShoppingCart } from "lucide-react";
import { addDays, format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  type AvailableProduct,
  type AvailableSlot,
  type Customer,
  useCreateCustomer,
  useCreateSale,
  useListAvailableProducts,
  useListAvailableSlots,
  useListCustomers,
} from "@/lib/phase2-api";
import { strings } from "@/lib/strings";
import { cn } from "@/lib/utils";

const todayStr = () => format(new Date(), "yyyy-MM-dd");
const nowDt = () => format(new Date(), "yyyy-MM-dd'T'HH:mm");

export default function NewSale() {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1 — Product
  const { data: products = [], isLoading } = useListAvailableProducts();
  const [product, setProduct] = useState<AvailableProduct>();

  // Step 2 — Customer
  const [customerSearch, setCustomerSearch] = useState("");
  const { data: customers = [] } = useListCustomers({ q: customerSearch || undefined });
  const [customer, setCustomer] = useState<Customer>();
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const createCustomer = useCreateCustomer();

  // Step 3 — Slot assignment
  const { data: slots = [] } = useListAvailableSlots(product ? { productId: product.id } : undefined);
  const [slotAssignment, setSlotAssignment] = useState<"auto" | "manual">("auto");
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot>();
  const skipSlotStep = useMemo(() => {
    if (!slots.length) return true;
    const ids = new Set(slots.map((s) => s.accountId));
    return ids.size <= 1;
  }, [slots]);

  // Step 4 — Dates & price
  const [startDate, setStartDate] = useState(todayStr());
  const [expiryDate, setExpiryDate] = useState(todayStr());
  const [expiryEdited, setExpiryEdited] = useState(false);
  const [price, setPrice] = useState(0);
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState<"cash" | "transfer" | "other">("cash");
  const [paidAt, setPaidAt] = useState(nowDt());
  const [notes, setNotes] = useState("");

  // Result
  const [subscriptionId, setSubscriptionId] = useState<number>();
  const createSale = useCreateSale();
  const { toast } = useToast();

  // Reset dependent state when product changes
  useEffect(() => {
    if (!product) return;
    setPrice(product.defaultPrice);
    setAmount(product.defaultPrice);
    if (!expiryEdited) {
      setExpiryDate(
        format(
          addDays(new Date(`${startDate}T00:00:00`), product.defaultDurationDays),
          "yyyy-MM-dd",
        ),
      );
    }
    setSelectedSlot(undefined);
    setSlotAssignment("auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // Recalculate expiry when startDate changes (unless user manually edited expiry)
  useEffect(() => {
    if (!product || expiryEdited) return;
    setExpiryDate(
      format(
        addDays(new Date(`${startDate}T00:00:00`), product.defaultDurationDays),
        "yyyy-MM-dd",
      ),
    );
  }, [startDate, product, expiryEdited]);

  const advance = () => {
    const next = step + 1;
    if (next === 3 && skipSlotStep) setStep(4);
    else setStep(next as 2 | 3 | 4 | 5);
  };

  const goBack = (target: 1 | 2 | 3 | 4 | 5) => {
    if (target === 3 && skipSlotStep) setStep(2);
    else setStep(target);
  };

  const handleCreateCustomer = () => {
    if (!newName.trim() || !newPhone.trim()) return;
    createCustomer.mutate(
      { data: { name: newName.trim(), phone: newPhone.trim(), whatsapp: newPhone.trim() } },
      {
        onSuccess: (c: Customer) => {
          setCustomer(c);
          advance();
        },
        onError: () => toast({ variant: "destructive", title: strings.sale.createCustomerError }),
      },
    );
  };

  const handleSubmit = () => {
    if (!product || !customer) return;
    createSale.mutate(
      {
        data: {
          productId: product.id,
          slotId: slotAssignment === "manual" ? selectedSlot?.id : undefined,
          customerId: customer.id,
          startDate,
          expiryDate,
          price,
          notes: notes.trim() || undefined,
          payment: {
            amount,
            method,
            paidAt: new Date(paidAt).toISOString(),
            notes: undefined,
          },
        },
      },
      {
        onSuccess: (result) => setSubscriptionId((result as any).subscription.id),
        onError: (err: any) => {
          const message = (() => {
            try { return JSON.parse(err.message)?.error; } catch { return undefined; }
          })();
          toast({ variant: "destructive", title: message || strings.app.error });
        },
      },
    );
  };

  if (subscriptionId) {
    return (
      <Card className="mx-auto max-w-lg text-center">
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <CheckCircle2 className="h-16 w-16 text-green-600" />
          <h1 className="text-2xl font-bold">{strings.sale.success}</h1>
          <p className="text-muted-foreground">{strings.sale.successDescription}</p>
          <Button asChild>
            <Link href={`/subscriptions/${subscriptionId}`}>{strings.sale.viewSubscription}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const completedSteps = [
    product && step > 1 ? 1 : null,
    customer && step > 2 ? 2 : null,
    !skipSlotStep && step > 3 ? 3 : null,
    step === 5 ? 4 : null,
  ].filter((n): n is number => n !== null);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{strings.sale.title}</h1>
        <p className="text-sm text-muted-foreground">{strings.sale.intro}</p>
      </div>

      <WizardProgress current={step} completed={completedSteps} skipSlot={skipSlotStep} />

      {/* Completed step summaries — click to go back */}
      {completedSteps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {product && step > 1 && (
            <SummaryChip label={`المنتج: ${product.name}`} onClick={() => goBack(1)} />
          )}
          {customer && step > 2 && (
            <SummaryChip label={`العميل: ${customer.name}`} onClick={() => goBack(2)} />
          )}
          {!skipSlotStep && step > 3 && (
            <SummaryChip
              label={
                slotAssignment === "auto"
                  ? "الخانة: تلقائي"
                  : `الخانة: ${selectedSlot?.accountLabel} · مقعد ${selectedSlot?.slotIndex}`
              }
              onClick={() => goBack(3)}
            />
          )}
          {step === 5 && (
            <SummaryChip
              label={`${startDate} ← ${expiryDate} · ${price}`}
              onClick={() => goBack(4)}
            />
          )}
        </div>
      )}

      {/* Step 1 — Product */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.productStep}</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : products.length === 0 ? (
              <p className="text-sm text-muted-foreground">{strings.sale.noAvailableProducts}</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(products as AvailableProduct[]).map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={p.freeSlotCount === 0}
                    onClick={() => { setProduct(p); advance(); }}
                    className={cn(
                      "rounded-lg border p-4 text-start transition hover:border-primary hover:bg-primary/5",
                      p.freeSlotCount === 0 && "cursor-not-allowed opacity-50",
                      product?.id === p.id && "border-primary bg-primary/5 ring-1 ring-primary",
                    )}
                  >
                    <strong className="block">{p.name}</strong>
                    {p.freeSlotCount === 0 ? (
                      <span className="text-xs text-destructive">مباع بالكامل</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {p.freeSlotCount} {strings.sale.freeSlots}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2 — Customer */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.customerStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative">
              <Search className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={customerSearch}
                onChange={(e) => { setCustomerSearch(e.target.value); setShowNewForm(false); }}
                placeholder={strings.customers.searchPlaceholder}
                className="pe-10"
                autoFocus
              />
            </div>

            {customerSearch && customers.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {(customers as Customer[]).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => { setCustomer(c); advance(); }}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-sm hover:bg-muted transition-colors"
                  >
                    <span>{c.name}</span>
                    <span className="text-muted-foreground" dir="ltr">{c.phone}</span>
                  </button>
                ))}
              </div>
            )}

            {customerSearch && customers.length === 0 && (
              <p className="text-sm text-muted-foreground">{strings.customers.noResults}</p>
            )}

            <button
              type="button"
              onClick={() => setShowNewForm(!showNewForm)}
              className="flex items-center gap-1 text-sm text-primary hover:underline"
            >
              <Plus className="h-4 w-4" />
              {strings.sale.newCustomer}
            </button>

            {showNewForm && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    placeholder={strings.customers.name}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <Input
                    dir="ltr"
                    className="text-start"
                    placeholder={strings.customers.phone}
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!newName.trim() || !newPhone.trim() || createCustomer.isPending}
                  onClick={handleCreateCustomer}
                >
                  {createCustomer.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    strings.sale.createCustomerInline
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Slot assignment (skipped if single account) */}
      {step === 3 && !skipSlotStep && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.slotStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              {(["auto", "manual"] as const).map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setSlotAssignment(val)}
                  className={cn(
                    "rounded-md border p-3 text-start text-sm transition",
                    slotAssignment === val && "border-primary bg-primary/5 ring-1 ring-primary",
                  )}
                >
                  <strong className="block">
                    {val === "auto" ? strings.sale.autoAssign : strings.sale.manualAssign}
                  </strong>
                  {val === "auto" && (
                    <span className="text-xs text-muted-foreground">
                      {strings.sale.autoAssignDescription}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {slotAssignment === "manual" && (
              <Select
                value={selectedSlot?.id.toString()}
                onValueChange={(v) =>
                  setSelectedSlot((slots as AvailableSlot[]).find((s) => s.id === Number(v)))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={strings.sale.selectSlot} />
                </SelectTrigger>
                <SelectContent>
                  {(slots as AvailableSlot[]).map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.accountLabel} · {strings.subscriptions.slot} {s.slotIndex}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              className="w-full"
              disabled={slotAssignment === "manual" && !selectedSlot}
              onClick={advance}
            >
              التالي
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4 — Dates & price */}
      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.datesStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{strings.subscriptions.startDate}</Label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{strings.subscriptions.expiryDate}</Label>
                <Input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => { setExpiryDate(e.target.value); setExpiryEdited(true); }}
                />
              </div>
              <div className="space-y-2">
                <Label>{strings.subscriptions.price}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={price}
                  onChange={(e) => {
                    setPrice(Number(e.target.value));
                    setAmount(Number(e.target.value));
                  }}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{strings.sale.paymentAmount}</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>{strings.sale.paymentMethod}</Label>
                <Select
                  value={method}
                  onValueChange={(v) => setMethod(v as "cash" | "transfer" | "other")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">{strings.sale.methodCash}</SelectItem>
                    <SelectItem value="transfer">{strings.sale.methodTransfer}</SelectItem>
                    <SelectItem value="other">{strings.sale.methodOther}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{strings.sale.paidAt}</Label>
                <Input
                  type="datetime-local"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>
                {strings.subscriptions.notes}{" "}
                <span className="text-xs text-muted-foreground">({strings.common.optional})</span>
              </Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            </div>

            {expiryDate < startDate && (
              <p className="text-sm text-destructive">{strings.sale.invalidDates}</p>
            )}

            <Button
              className="w-full"
              disabled={expiryDate < startDate}
              onClick={advance}
            >
              التالي
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 5 — Confirm */}
      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>{strings.sale.confirmStep}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <ConfirmRow label="المنتج" value={product?.name ?? ""} />
              <ConfirmRow label="العميل" value={`${customer?.name} · ${customer?.phone}`} />
              <ConfirmRow
                label="الخانة"
                value={
                  skipSlotStep || slotAssignment === "auto"
                    ? "تلقائي"
                    : `${selectedSlot?.accountLabel} · مقعد ${selectedSlot?.slotIndex}`
                }
              />
              <ConfirmRow label={strings.subscriptions.startDate} value={startDate} />
              <ConfirmRow label={strings.subscriptions.expiryDate} value={expiryDate} />
              <ConfirmRow label={strings.subscriptions.price} value={String(price)} />
              <ConfirmRow label={strings.sale.paymentAmount} value={String(amount)} />
              <ConfirmRow
                label={strings.sale.paymentMethod}
                value={
                  method === "cash"
                    ? strings.sale.methodCash
                    : method === "transfer"
                      ? strings.sale.methodTransfer
                      : strings.sale.methodOther
                }
              />
            </dl>
            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={createSale.isPending}
            >
              {createSale.isPending ? (
                <Loader2 className="me-2 h-5 w-5 animate-spin" />
              ) : (
                <ShoppingCart className="me-2 h-5 w-5" />
              )}
              {strings.sale.confirm}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function WizardProgress({
  current,
  completed,
  skipSlot,
}: {
  current: number;
  completed: number[];
  skipSlot: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n, i) => {
        const isSkipped = n === 3 && skipSlot;
        const isDone = completed.includes(n);
        const isActive = current === n;
        return (
          <div key={n} className="flex flex-1 items-center gap-1">
            <div
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition",
                isSkipped && "opacity-30 bg-muted text-muted-foreground",
                isDone && !isSkipped && "bg-primary/20 text-primary",
                isActive && "bg-primary text-primary-foreground",
                !isDone && !isActive && !isSkipped && "bg-muted text-muted-foreground",
              )}
            >
              {isDone && !isSkipped ? <Check className="h-3.5 w-3.5" /> : n}
            </div>
            {i < 4 && <div className="flex-1 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function SummaryChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border bg-muted px-3 py-1 text-xs hover:bg-muted/70 transition-colors"
    >
      <Check className="h-3 w-3 text-primary" />
      {label}
    </button>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm run typecheck
```
Expected: exit 0. If TypeScript complains about `AvailableProduct.defaultPrice` not existing, check the generated type in `lib/api-zod/src/generated/types/saleProductAvailability.ts` and adjust the property access accordingly.

- [ ] **Step 3: Commit**

```
git add artifacts/accounts-manager/src/pages/new-sale.tsx
git commit -m "feat: rewrite new-sale as 5-step wizard with progress indicator"
```

---

## Task 12: Remove repo clutter

- [ ] **Step 1: Remove committed clutter**

```
git rm -r artifacts/mockup-sandbox
git rm scripts/src/hello.ts
git rm -r replit-prompts
git rm -r lib/api-spec/node_modules
```

- [ ] **Step 2: Verify only expected files are staged**

```
git status
```
Expected: only deletions staged, no unexpected changes.

- [ ] **Step 3: Commit**

```
git commit -m "chore: remove mockup-sandbox, hello.ts, replit-prompts, and stale api-spec/node_modules"
```

---

## Final verification

- [ ] Start the API server: `pnpm --filter @workspace/api-server run dev`
- [ ] Start the frontend: `pnpm --filter @workspace/accounts-manager run dev`
- [ ] Open browser at http://localhost:5173
- [ ] Verify login redirects to `/` (dashboard) after success
- [ ] Verify dashboard shows the renewal alert card (not 3 amber cards), capacity bars, overdue renew buttons, and skeleton while loading
- [ ] Verify New Sale wizard: step 1 selects product and advances, step 2 shows search dropdown, step 3 skips if single account, step 5 shows confirm summary
- [ ] Verify audit log shows page 1/2 buttons when more than 100 entries exist (or 0 buttons when fewer)
- [ ] Run full typecheck: `pnpm run typecheck`
