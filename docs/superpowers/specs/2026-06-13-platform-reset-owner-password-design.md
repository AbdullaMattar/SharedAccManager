# Design: Platform admin — reset org owner password

Date: 2026-06-13

## Overview

Let the superadmin reset the password for an organization's owner directly from the `إدارة المنصة` page. Scope: owner only (earliest admin user by `createdAt`). No schema changes required.

---

## Backend — `artifacts/api-server/src/routes/platform.ts`

- New route `POST /platform/orgs/:id/reset-owner-password`, already covered by `router.use("/platform", requireAuth, requireSuperadmin)`.
- Validate `:id` with `idParamsSchema`. Block `DEMO_ORG_ID` (1) with HTTP 400.
- Validate body `{ password }` with `passwordResetSchema` (already exported from `@workspace/db`, enforces min 8 chars).
- Find the org's owner: earliest admin user in that org (`WHERE orgId = id AND role = "admin" ORDER BY createdAt ASC LIMIT 1`).
- In a `db.transaction`: hash the new password with `bcrypt.hashSync(password, 12)`, update `usersTable` row, insert `platform_reset_owner_password` audit log entry (`orgId: null`, actor = superadmin, detail includes org name and owner email).
- Returns `{ ok: true }`. 404 if org or owner not found.

---

## Frontend

### Hook — `artifacts/accounts-manager/src/lib/phase3-api.ts`
Add `useResetOrgOwnerPassword`:
```ts
mutationFn: ({ id, password }: { id: number; password: string }) =>
  request(`/api/platform/orgs/${id}/reset-owner-password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  })
```

### UI — `artifacts/accounts-manager/src/pages/platform.tsx`
- Import `KeyRound` from lucide-react and `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogFooter` from `@/components/ui/dialog`.
- Add state: `resetPasswordOrg: PlatformOrg | undefined` and `newPassword: string`.
- In the actions cell (next to تعليق and حذف), add a ghost icon button with `KeyRound` that sets `resetPasswordOrg` — hidden for demo org (#1).
- Dialog opens when `resetPasswordOrg` is set: shows org name in title, a password `Input`, and a save button that calls the mutation. On success: close dialog, clear password, toast. On error: toast.

---

## Out of scope
- Resetting passwords for non-owner users from the platform page.
- Email notifications.
- Forcing the user to change password on next login.
