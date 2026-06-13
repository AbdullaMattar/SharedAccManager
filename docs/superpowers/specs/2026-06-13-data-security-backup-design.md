# امن البيانات (Data Security) — Per-Org Encrypted Backup Download

**Date:** 2026-06-13
**Status:** Design approved, pending spec review

## Goal

Give each customer business (organization) the ability to download a complete,
password-protected backup of **its own** data. This is a **customer-trust
feature** ("you own your data") and the founding piece of a new **"امن البيانات"
(Data Security)** page.

It is explicitly **not** a disaster-recovery mechanism for the platform — the
whole-DB off-site backup gap is a separate concern. This feature protects the
*customer*; that one protects *Tasheel*.

## Scope

### In scope (v1)
- A new admin-guarded **"امن البيانات"** page with one action: **"تنزيل نسخة
  احتياطية" (Download backup)**.
- Backend endpoint that builds a password-protected `.xlsx` of the requesting
  org's data and streams it as a download.
- Whole-file encryption using Excel's native (AES) "password to open", with a
  passphrase the customer chooses at download time.
- The file includes decrypted provider-account passwords.
- An audit-log entry per export.

### Out of scope (phase 2+)
- Google Drive connect + scheduled auto-push (this page is its future home).
- Restore / re-import of a backup back into the app.
- Scheduling / automatic recurring exports.
- Platform-admin ("superadmin") ability to export any org — **deliberately not
  built**; this is org-admin self-service only.

## Who can use it

- **Org admins only, own-org only.** Guard stack:
  `requireAuth` → `requireOrgUser` → `requireAdmin`.
- `requireAdmin` already excludes the platform superadmin (role `superadmin`,
  not `admin`), and `requireOrgUser` guarantees a non-null `orgId`.
- The exported `orgId` is read from the session
  (`getRequestUser(req).orgId!`) and **never** from the request body. This is
  the multi-tenant firewall: an admin can only ever export their own org.

## Architecture

```
[Data Security page]
  -> passphrase modal (passphrase + confirm + warning)
  -> POST /api/backup/export  { passphrase }
       requireAuth, requireOrgUser, requireAdmin
  -> backup-export builder (orgId from session)
       query org-scoped rows -> decrypt account passwords -> build workbook
  -> encrypt workbook with passphrase (native xlsx AES)
  -> write audit entry (action: "data_export")
  -> stream .xlsx (attachment)
  -> browser saves backup-<business>-<YYYY-MM-DD>.xlsx
```

### Backend

**New route module:** `artifacts/api-server/src/routes/backup.ts`
- `router.use("/backup", requireAuth, requireOrgUser, requireAdmin)`
- `POST /backup/export`:
  1. Validate body `{ passphrase: string }` — **min 8 chars**; reject with 400
     otherwise. (Confirm-field matching is enforced client-side; the server only
     needs the single passphrase.)
  2. `orgId = getRequestUser(req).orgId!`
  3. Call the builder to produce an encrypted buffer.
  4. Insert audit entry:
     `db.insert(auditLogTable).values({ userId: user.id, orgId, action: "data_export", entity: "organization", entityId: orgId, detail: "تنزيل نسخة احتياطية مشفّرة" })`
  5. Respond with headers:
     - `Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
     - `Content-Disposition: attachment; filename="backup-<slug>-<date>.xlsx"`
     and send the buffer.
- Register in `artifacts/api-server/src/routes/index.ts`.

**New builder module:** `artifacts/api-server/src/lib/backup-export.ts`
Two separable steps so each is independently testable:
- `buildOrgWorkbook(orgId): Promise<Buffer>` — queries org-scoped rows, decrypts
  account passwords via `decrypt()` from `lib/crypto`, assembles the workbook,
  returns the *plaintext* `.xlsx` buffer.
- `encryptXlsx(buffer, passphrase): Buffer` — applies native OOXML "password to
  open" encryption.
- A thin `exportOrgBackup(orgId, passphrase)` composes the two.

All queries filter on `eq(table.orgId, orgId)`, mirroring the established
pattern in `routes/accounts.ts`.

**Encryption library — to confirm during planning (the one real risk):**
Native Office "password to open" is true AES (agile encryption). Candidate
approaches:
1. `exceljs` to build + `officecrypto-tool` to encrypt the buffer.
2. `xlsx-populate` (builds and password-encrypts in one lib).
Planning task: verify one produces a file that opens in both desktop Excel and
Google Sheets with the passphrase, and rejects a wrong passphrase. Pick the
simpler working option; add it to the api-server package only.

### Workbook contents

One workbook, one sheet per area. Columns map to existing org-scoped tables.

- **ملخص (Summary):** business name, export date/time, row counts, and a plain
  warning: the file is password-protected, contains account passwords, the
  passphrase cannot be recovered, keep it safe.
- **العملاء (Customers):** name, phone, whatsapp (if present), created date.
- **الاشتراكات (Subscriptions):** customer name, customer phone, product,
  account label, slot index, start date, expiry date, status, price.
- **المدفوعات (Payments):** date, amount, method, customer, linked subscription.
- **الحسابات (Accounts):** product, label, email, **password (decrypted)**,
  capacity, status, start date, expiry date, notes.

Excluded by design: staff users, audit log (internal, not the customer's
business data).

### Frontend

**New page:** `artifacts/accounts-manager/src/pages/data-security.tsx`
- Renders inside `Layout`. Heading + short explanatory copy + the download
  card/button + passphrase modal.
- Modal fields: passphrase, confirm passphrase, an inline warning. Submit
  disabled until both match and length ≥ 8.

**Route (App.tsx):** `/admin/data-security` wrapped
`<AuthGuard><OrgGuard><AdminGuard><DataSecurity/></AdminGuard></OrgGuard></AuthGuard>`,
matching the other `/admin/*` routes.

**Nav (layout.tsx):** add an item in the `user?.role === "admin"` block, e.g.
`{ href: "/admin/data-security", label: strings.dataSecurity.nav, icon: ShieldCheck }`
(pick a distinct lucide icon, e.g. `DatabaseBackup` / `ShieldCheck`).

**Download mechanism:** the existing `request<T>()` helper in `phase3-api.ts`
parses JSON and cannot handle a binary body. Add a dedicated function that:
```ts
const res = await fetch("/api/backup/export", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ passphrase }),
});
if (!res.ok) throw new Error(await res.text());
const blob = await res.blob();
// create object URL, click a temporary <a download>, revoke URL
```
Show a spinner while generating and a success/error toast (existing toaster).

**Strings:** add an Arabic `strings.dataSecurity.*` group (page title, intro,
button, modal labels, warning, success/error). All copy Arabic/RTL.

## Security

- Org-admin only; org scoping derived from session, never client input.
- Passphrase: min length enforced both client and server; used transiently;
  **never stored, never logged**.
- Decrypted passwords and workbook bytes never logged.
- Endpoint rate-limited (reuse the existing limiter applied to login/reveal).
- Audit entry written per export, consistent with `credential_reveal`.
- File encryption is real AES via the xlsx format — the plaintext workbook
  exists only briefly in server memory and is never sent to the browser
  unencrypted.

## Error handling

- Missing/short passphrase → 400 (Arabic message).
- Non-admin / non-org / unauthenticated → 403/401 via guards.
- Builder or encryption failure → 500 with a generic Arabic message; log the
  error server-side without sensitive content.
- Workbook built in memory (fine at this scale: ~1–2s, tens of MB). Streaming
  writer is the documented escape hatch if data ever grows large.

## Testing

The repo currently has no automated test harness, so this adds a focused one.

- **Primary (cross-tenant isolation):** seed two orgs with distinct data, run
  the builder for org A, assert the produced workbook contains **none** of org
  B's rows. This is the highest-risk correctness property of a multi-tenant
  export.
- **Builder content:** assert each expected sheet exists and a sample row maps
  correctly (including a decrypted account password).
- **Encryption round-trip:** encrypt with a passphrase, confirm the file opens
  with the correct passphrase and fails with a wrong one.
- **Manual:** open the downloaded file in Excel and Google Sheets with the
  passphrase; verify RTL/Arabic headers and contents; verify wrong passphrase
  is rejected.

## File structure

**New files**
- `artifacts/api-server/src/routes/backup.ts` — export endpoint
- `artifacts/api-server/src/lib/backup-export.ts` — builder + encrypt
- `artifacts/accounts-manager/src/pages/data-security.tsx` — page + modal
- test file(s) for the builder (location/runner decided in planning)

**Modified files**
- `artifacts/api-server/src/routes/index.ts` — register backup router
- `artifacts/api-server/package.json` — add the xlsx/encryption dependency
- `artifacts/accounts-manager/src/App.tsx` — add `/admin/data-security` route
- `artifacts/accounts-manager/src/components/layout.tsx` — add admin nav item
- `artifacts/accounts-manager/src/lib/phase3-api.ts` — add blob download helper
- `artifacts/accounts-manager/src/lib/strings.ts` — `dataSecurity.*` strings

## Phase 2 (not now)

The same page later gains "Connect Google Drive" (OAuth `drive.file` scope,
encrypted refresh token via existing `crypto.ts`) and a nightly auto-push that
reuses the `daily-maintenance` cron. Per-org passphrase handling for unattended
encryption is a phase-2 design question (likely a stored, per-org backup
passphrase set on the same page).
