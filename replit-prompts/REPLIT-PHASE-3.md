# Replit Prompt — Phase 3 of 3: Renewals, Dashboard, Settings & Polish ⭐

> Copy this entire file into Replit AI after Phase 2 is complete and verified.
> This is the FINAL phase and contains the **#1 reason this app exists: never miss a renewal.**
> Already built — Phase 1: Arabic/RTL Next.js + Tailwind, Auth.js login, Prisma + SQLite full schema, Products/Accounts/Slots, encrypted credentials with audited reveal. Phase 2: Customers CRUD + search, new-sale flow (subscription + full payment + slot occupied), subscription list/detail, cancel.

---

## Project recap (context)

**"Shared Accounts Manager"** — internal, staff-only Arabic/RTL app for a shared-subscription reselling business.

```
Product → Account → Slot → Subscription → Customer
```

Subscriptions carry `start_date` / `expiry_date`. The business previously tracked renewals from memory in WhatsApp — this phase makes expiry visible and renewal one tap.

---

## Standing constraints (keep following them)

- **Arabic-first, RTL-only**: every new screen/widget/toast in Arabic, strings in the central strings file, Tailwind logical properties, directional icons flipped.
- **Mobile-first**: dashboard and expiring-soon views must be excellent at 375px — these are the screens staff will open every morning on their phones.
- **SQLite + Prisma only**; single Next.js process. **No external queue/worker** — scheduled work runs via `node-cron` INSIDE the app process.
- **Numerals** 0-9, **Gregorian** dates.
- **Audit**: renewals, payments, settings changes, and user management write to `audit_log`.

---

## Phase 3 scope — build these now

### A. Expiry status engine (build first — everything else reads it)

1. **Computed-on-read rule**: a subscription with `status = active` whose `expiry_date` is in the past is treated as **expired everywhere it is displayed or queried**. Implement one shared helper (e.g. `lib/subscription-status.ts`) used by ALL queries — never duplicate this logic per page.
2. **Daily cron rollover**: `node-cron` inside the app process (initialize once, e.g. via Next.js `instrumentation.ts`) runs daily and persists `active → expired` where `expiry_date < now`. The computed-on-read rule means a missed tick never shows wrong data; the cron just keeps the DB tidy.
3. Decide slot behavior on expiry via settings (see D): default = slot **stays occupied during a grace period** (`grace_days`, default 3) so late renewals keep their slot; after grace, the cron frees the slot.

### B. Dashboard — the new landing page (after login)

Arabic widgets, mobile-first:

1. **Expiring counts**: subscriptions expiring within **1 / 3 / 7 days** (three tappable cards → each opens the expiring-soon view pre-filtered).
2. **Overdue list**: expired-but-not-renewed subscriptions needing action (most overdue first).
3. **Free slots per product**: "what can I sell right now?" — product name + free count.
4. **Quick totals**: active subscriptions, total accounts, **revenue logged this month** (sum of payments where `paid_at` is in the current month).

### C. "تنتهي قريباً" (Expiring soon) view + one-click renew — THE core feature

1. **Expiring-soon list**, sorted by expiry date ascending, each row showing: customer name, phone, product, account label, expiry date, days remaining (Arabic, e.g. "باقي ٣ أيام" using 0-9 numerals: "باقي 3 أيام").
2. **One-tap WhatsApp button** per row: `https://wa.me/<phone>?text=<encoded Arabic reminder>` — pre-filled Arabic message template including customer name, product, and expiry date (template string lives in the central strings file).
3. **One-click Renew (تجديد)** per row (and on the subscription detail page):
   - Opens a small confirm sheet prefilled with: new period = product `default_duration_days` (editable), price = previous price (editable), payment method.
   - On confirm, in ONE transaction: **create a NEW subscription row** on the same slot for the same customer (start = old expiry date — or today if it already lapsed — end = start + duration), mark the old one `expired`, log the **payment in full**, keep the slot `occupied`, and write `audit_log` (action=`renew`).
   - NEVER edit the old subscription's dates — history must be preserved. The slot's subscription history is the renewal chain.
4. Renewed subscriptions disappear from expiring/overdue lists immediately.

### D. Settings page (Arabic), backed by the `settings` table

Editable by admins; read LIVE by the dashboard, expiring-soon view, and cron (no redeploy needed):

- `reminder_lead_days` — how many days before expiry a subscription counts as "expiring soon" (default 3).
- `reminder_recipient` — staff / customer / both (default: staff). Controls hint text + whether the WhatsApp template targets the customer.
- `grace_days` — days an expired subscription keeps its slot before the cron frees it (default 3).
- `business_name` — shown in the header.
- `currency` — Arabic label used wherever prices are shown (default e.g. "د.ب" or "ر.س" — make it just a settings value).

### E. Roles, audit view & polish (final hardening)

1. **Roles enforced server-side**: `admin` manages users (create/edit/disable staff, reset passwords) and sees everything; `staff` does day-to-day operations and CANNOT access user management or settings. Arabic role labels (مدير / موظف). Enforce in server actions/APIs, not just by hiding links.
2. **User management page** (admin only) — list/create/edit staff users.
3. **Audit log view** (admin only) — readable Arabic table: who, action, entity, when; newest first; filter by action.
4. **Notes everywhere**: confirm notes fields are visible & editable on accounts, customers, and subscriptions.
5. **Basic reporting**: a simple Arabic report — revenue this month + breakdown by product.
6. **Mobile layout pass** over the whole app: RTL spacing, tap targets ≥ 44px, table→card collapse on small screens.
7. **Scheduled backup**: a daily cron task copies the SQLite file to `./data/backups/app-YYYY-MM-DD.db` (keep last 14). Document restore steps in `README.md`.
8. **Security pass**: session cookies httpOnly (+ secure in production), encryption key only from env, RBAC verified server-side on every admin route/action, no plaintext credentials anywhere in responses or logs.

---

## Acceptance criteria (Phase 3 / project is DONE when)

- [ ] Logging in lands on the Arabic dashboard with correct expiring 1/3/7 counts, overdue list, free-slots-per-product, and monthly revenue.
- [ ] A subscription expiring in 2 days appears in "تنتهي قريباً"; tapping WhatsApp opens wa.me with the pre-filled Arabic message; tapping تجديد creates a NEW subscription row + payment + audit entry, and the item leaves the list.
- [ ] An `active` subscription whose expiry passed displays as expired even if the cron hasn't run (computed on read).
- [ ] The cron persists expirations daily and frees slots only after `grace_days`.
- [ ] Changing `reminder_lead_days` in settings immediately changes what "expiring soon" shows.
- [ ] A `staff` user cannot open user management or settings (blocked server-side, not just hidden).
- [ ] Audit log view shows reveals, sales, renewals, and settings changes.
- [ ] Daily backup files appear under `./data/backups/` with restore steps documented.
- [ ] Whole app is Arabic + RTL and clean at 375px.
