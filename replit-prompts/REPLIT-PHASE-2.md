# Replit Prompt — Phase 2 of 3: Customers & Sales

> Copy this entire file into Replit AI after Phase 1 is complete and verified.
> This is part 2 of a 3-phase build. Phase 1 already delivered: Next.js (App Router) + Tailwind + TypeScript, Arabic/RTL everywhere, Auth.js staff login, Prisma + SQLite (full schema already migrated, including `customers`, `subscriptions`, `payments`), AES-256-GCM credential encryption, Products/Accounts/Slots CRUD with audited credential reveal.
> Do NOT build Phase 3 features yet (dashboard, renewals, expiring-soon, settings page, cron).

---

## Project recap (context)

**"Shared Accounts Manager"** — internal, staff-only Arabic/RTL app for a shared-subscription reselling business. The unit of sale is a **slot**:

```
Product → Account → Slot → Subscription → Customer
```

A **subscription** sells one slot to one customer for a date range (`start_date` → `expiry_date`). A slot can hold many subscriptions over time, but only ONE active at a time. Payments are manual records, paid in full at sale (no installments, no payment gateway).

---

## Standing constraints (carried over from Phase 1 — keep following them)

- **Arabic-first, RTL-only UI**: all new screens, forms, tables, toasts, validation, and empty states in Arabic. `dir="rtl"`. Tailwind logical properties only (`ps-`/`pe-`/`ms-`/`me-`). All strings go in the existing central strings file (`messages/ar.json` / `lib/strings.ts`) — no hardcoded copy in components.
- **Mobile-first**: staff use phones. Every new screen works at 375px; tables collapse to cards.
- **SQLite via Prisma only** — no external DB. The schema for `customers`, `subscriptions`, `payments` already exists from Phase 1; write migrations only if a column is genuinely missing.
- **Numerals**: Western Arabic (0-9). **Calendar**: Gregorian. Dates entered/displayed as Gregorian.
- **Audit**: meaningful mutations write to `audit_log` (user_id, action, entity, entity_id, detail).
- **Secrets** stay in Replit Secrets / env; nothing committed.

---

## Phase 2 scope — build these now

### A. Customers

1. **Customers CRUD** — fields: name, phone (**unique** — it's the natural key; staff reach customers on WhatsApp), whatsapp number (defaults to phone), email (optional), notes.
   - Duplicate-phone attempts show a clear Arabic error.
2. **Customer search** — one search box matching **name OR phone** (partial match), fast enough to use mid-conversation on a phone.
3. **Customer detail page** — shows:
   - Customer info + notes.
   - **All their subscriptions, past and present** (product, account label, slot, start, expiry, price, status badge in Arabic: نشط / منتهي / ملغي).
   - **Total spent** (sum of their payments).
   - A `wa.me/<phone>` link button to open WhatsApp with them.

### B. New-sale flow (the heart of this phase)

One screen, mobile-first, Arabic, in this order:

1. **Pick product** → shows only products that currently have at least one free slot (show free-slot count per product).
2. **Pick a free slot** — default to **auto-assign** (first free slot in the oldest account), with an option to manually choose a specific account/slot.
3. **Pick or create customer** — search-as-you-type by name/phone; an inline "عميل جديد" mini-form creates one without leaving the flow.
4. **Dates & price** — `start_date` defaults to today; `expiry_date` **prefilled from the product's `default_duration_days`** but editable; `price` prefilled from the product's `default_price` but editable.
5. **Log payment in full** — amount (defaults to price), method (نقدي / تحويل / أخرى), paid_at (defaults to now). One payment per sale; recorded as paid in full.
6. **Confirm** → in a single transaction:
   - Create the `subscription` (status `active`).
   - Create the `payment` (logged_by = current user).
   - Flip the slot's status to `occupied`.
   - Write an `audit_log` row (action=`sale`).
   - Show an Arabic success state with a link to the new subscription.

Guards:
- A slot with an active subscription can never be sold again (enforce server-side, not just in UI).
- Validation errors in Arabic (e.g. expiry before start, missing customer).

### C. Subscriptions

1. **Subscriptions list** — filterable by status (نشط / منتهي / ملغي), showing customer, product, slot, expiry date, price.
2. **Subscription detail page** — full record: customer (linked), product/account/slot, dates, price, status, notes (editable), payment(s), and the **history of all subscriptions on the same slot** (this becomes the renewal chain in Phase 3).
3. **Cancel subscription** action — sets status to `cancelled`, frees the slot, writes audit log, asks for Arabic confirmation first.

### D. Navigation
Add to the main nav: العملاء (Customers), الاشتراكات (Subscriptions), and a prominent **بيع جديد** (New Sale) button.

### E. Out of scope — do NOT build
- Dashboard / landing widgets, expiring-soon view, renew action, WhatsApp reminder templates, settings page, cron/expiry rollover (Phase 3).
- Roles beyond login, audit-log viewer, backups, reporting (Phase 3).

---

## Acceptance criteria (Phase 2 is done when)

- [ ] A full sale works end-to-end on a phone viewport: pick product → auto-assigned free slot → create a new customer inline → confirm → subscription active + payment recorded + slot occupied.
- [ ] The sold slot disappears from the free pool; trying to sell it again is blocked server-side.
- [ ] The new sale appears on the customer's detail page with correct total spent.
- [ ] Customer search finds customers by partial name and by phone.
- [ ] Duplicate phone is rejected with an Arabic error.
- [ ] Cancelling a subscription frees its slot and is audit-logged.
- [ ] Every new screen is Arabic + RTL, strings centralized, works at 375px.
- [ ] Sale and cancel actions write `audit_log` rows.
