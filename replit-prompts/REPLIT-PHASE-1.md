# Replit Prompt — Phase 1 of 3: Foundation + Inventory

> Copy this entire file into Replit AI as the build prompt for Phase 1.
> This is part 1 of a 3-phase build. Do NOT build features from later phases (customers, sales, dashboard, renewals) — they come in Phase 2 and Phase 3.

---

## What we are building (project context — read first)

**"Shared Accounts Manager"** — an internal, staff-only web app for a business that resells subscription accounts (Netflix, Spotify, ChatGPT, …). Today the business runs entirely on WhatsApp chats; this tool replaces that with a real system. v1 is staff-only: no customer login, no online payments. Scale is small (~under 100 active subscriptions), so the architecture is deliberately minimal: **one Next.js app + one SQLite file. No external database server.**

### The core abstraction (critical — model everything around this)

The unit of sale is a **slot**, not an account:

- Some products are sold as slots inside one shared account (e.g. 1 of 5 Netflix profiles).
- Some products are sold as a whole account (capacity = 1).

```
Product → Account → Slot → Subscription → Customer
```

- **Product**: a sellable plan ("Netflix Premium — shared"). Defines default capacity, default duration, default price.
- **Account**: a real purchased account the business owns. Holds login credentials (encrypted). Has `capacity` (5 for shared Netflix, 1 for a full account).
- **Slot**: one sellable unit inside an account. `capacity` slots are auto-created per account. Free or occupied.
- **Subscription** (Phase 2): a slot sold to a customer for a date range.
- **Customer** (Phase 2): the buyer; phone is the natural key.

---

## Hard constraints (apply to EVERYTHING you build, all phases)

### 1. Arabic-first, RTL-only UI 🌐
- `<html lang="ar" dir="rtl">` is the document default. The entire UI is Arabic. There is no English UI and no language switcher in v1.
- Tailwind must use **logical properties** (`ps-`/`pe-`/`ms-`/`me-`, `start`/`end`) instead of physical `left`/`right` so layout mirrors correctly.
- Bundle an Arabic web font locally (**Cairo** or **Tajawal** or **IBM Plex Sans Arabic**) — self-hosted in the repo, NOT fetched from Google Fonts at runtime.
- Centralize ALL user-facing strings in one file: `messages/ar.json` (or `lib/strings.ts`). No hardcoded copy inside components.
- Directional icons (back, next, chevrons) must flip for RTL.
- Forms, tables, toasts, validation messages, empty states, and error pages: all Arabic + RTL.
- Numerals: Western Arabic (0-9). Calendar: Gregorian.

### 2. Mobile-first 📱
Staff use this mostly on phones. Every screen must work on a mobile viewport (375px). Tables collapse to cards on small screens.

### 3. Single process, single SQLite file 🗄️
- Database: **SQLite via Prisma ORM**. The `.db` file must live at a stable persistent path (e.g. `./data/app.db`) — configure `DATABASE_URL="file:./data/app.db"`.
- No Postgres, no MySQL, no external DB service. Do not provision a Replit PostgreSQL database.

### 4. Secrets via environment 🔐
- `AUTH_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL` come from environment variables — on Replit, use **Replit Secrets**. Never commit them. Provide a `.env.example` documenting each.

### 5. Docker files for later self-hosting 🐳
Replit runs the app natively, but the project will eventually self-host via Docker. Generate (do not run on Replit):
- `Dockerfile`: multi-stage (deps → build → standalone runtime), with Next.js `output: 'standalone'` enabled in `next.config`.
- `docker-compose.yml`: single service, named volume mounted for the SQLite `data/` dir, env wiring from `.env`.
- `.dockerignore`.
- Container entrypoint runs `prisma migrate deploy` before starting the server.

---

## Tech stack (use exactly this)

- **Next.js (App Router) + Tailwind CSS**, TypeScript, `output: 'standalone'`.
- **SQLite + Prisma ORM** (migrations checked into the repo).
- **Auth.js (NextAuth) credentials provider** + bcrypt password hashing. Staff accounts only.
- **Node `crypto` AES-256-GCM** for encrypting stored account passwords; key from `ENCRYPTION_KEY` env var.

---

## Phase 1 scope — build these now

### A. Project foundation
1. Next.js App Router + Tailwind + TypeScript scaffold, Arabic/RTL configured globally per constraints above.
2. Base layout: header with app name (Arabic), nav (mobile-friendly), main content area. Nav links for: المنتجات (Products), الحسابات (Accounts) — more added in later phases.
3. Prisma + SQLite wired up; migrations work.
4. **Auth**: Arabic login page (email + password). Protected route group: every page except login requires a session. Sessions via httpOnly cookies. Seed script creates an initial admin user (email/password from env or printed to console).
5. **Encryption util** (`lib/crypto.ts`): AES-256-GCM `encrypt(plaintext)` / `decrypt(ciphertext)` reading `ENCRYPTION_KEY` from env. Include unit tests.

### B. Database schema (create ALL tables now, even ones used later — saves migration churn)

```prisma
// Conceptual schema — translate to proper Prisma models with relations

products      id, name, service, default_capacity, default_duration_days,
              default_price, notes, created_at

accounts      id, product_id FK, label, email, password_encrypted,
              capacity, status (active|disabled|needs_attention), notes, created_at

slots         id, account_id FK, slot_index, status (free|occupied|disabled)

customers     id, name, phone (unique), whatsapp, email, notes, created_at

subscriptions id, slot_id FK, customer_id FK, start_date, expiry_date,
              price, status (active|expired|cancelled), notes, created_at

payments      id, subscription_id FK, amount, method (cash|transfer|other),
              paid_at, logged_by FK->users, notes

settings      key (unique), value

users         id, name, email (unique), password_hash, role (admin|staff), created_at

audit_log     id, user_id FK, action, entity, entity_id, detail, created_at
```

Key rules:
- Renewals will later be NEW subscription rows (history preserved), never date edits — design relations accordingly (a slot has many subscriptions over time).
- `slots.status` is stored explicitly (a slot can be manually `disabled`), but free/occupied tracks whether it has an active subscription.

### C. Inventory features (the Phase 1 deliverable)

1. **Products CRUD** — list, create, edit, delete. Fields: name, service, default capacity, default duration (days), default price, notes. Arabic forms with validation messages in Arabic.
2. **Accounts CRUD** — fields: product (select), label, email, password (encrypted on save via the crypto util), capacity (prefilled from product's default), status, notes.
   - On create: **auto-generate `capacity` slot rows** (slot_index 1..capacity, status `free`).
   - On capacity edit: reconcile slots safely — add slots when capacity grows; when it shrinks, only remove FREE slots and refuse to drop below the number of occupied slots (Arabic error message).
3. **Credential reveal** — account passwords are never shown by default. An **"إظهار"** button decrypts and displays the password, and writes an `audit_log` row (user, action=`credential_reveal`, entity=`account`, entity_id). Hide again on toggle/navigate.
4. **Account list view** — per account: label, product, status badge in Arabic (نشط / معطّل / يحتاج انتباه), and a **visual slot indicator** showing free vs occupied slots (e.g. filled/empty dots: ●●○○○ = 2 of 5 used).

### D. Out of scope for this phase — do NOT build
- Customers UI, sales flow, subscriptions UI, payments UI (Phase 2).
- Dashboard, renewals, expiring-soon view, settings page, cron jobs (Phase 3).
- User management UI / role enforcement beyond login (Phase 3).
(The tables exist; the features don't yet.)

---

## Acceptance criteria (Phase 1 is done when)

- [ ] App runs on Replit; logging in with the seeded admin works; logged-out users are redirected to the Arabic login page.
- [ ] Entire UI is Arabic + RTL, usable at 375px width.
- [ ] Staff can create a product, then an account with capacity 5 → 5 free slots auto-appear; an account with capacity 1 → 1 slot.
- [ ] Account password is stored encrypted (verify the DB column is not plaintext), and "إظهار" reveals it + creates an `audit_log` row.
- [ ] Editing capacity up/down reconciles slots; shrinking below occupied count is blocked with an Arabic error.
- [ ] All strings live in the central strings file.
- [ ] `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.env.example` exist and are coherent (not run on Replit).
- [ ] SQLite file lives under `./data/` and survives restarts.
