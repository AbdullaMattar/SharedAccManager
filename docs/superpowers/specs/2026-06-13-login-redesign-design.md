# Design: Login page redesign (identity + intro + social proof)

Date: 2026-06-13

## Goal
Give the login page a clear identity, a short intro to what the service does, and a social-proof line ("used by many businesses"). Minimal/monochrome treatment, single centered card layout.

## Scope
- Modify: `artifacts/accounts-manager/src/pages/login.tsx` (presentation only — auth logic unchanged).
- Modify: `artifacts/accounts-manager/src/lib/strings.ts` (new copy).
- No new components, no new dependencies. Cairo font already loaded; existing theme tokens (foreground/muted/border/primary) and dark mode reused.

## Layout (RTL, single centered card, widen to `max-w-lg`)
Top → bottom inside the card:

1. **Brand band** — monochrome wordmark lockup: a subtle bordered icon tile (Lucide `Layers`, in `text-foreground`/muted tone, NOT colored/gradient) next to the product name, with a one-line tagline beneath.
   - Name: `مدير الحسابات المشتركة`
   - Tagline: `نظّم حساباتك المشتركة وعملاءك واشتراكاتك في مكان واحد`
2. **Intro line** — one short muted sentence: `منصة متكاملة لإدارة الحسابات المشتركة: تتابع الاشتراكات، تنبّهك قبل انتهائها، وتنظّم مدفوعات عملائك.`
3. **Form** — existing login/register/demo/switch behavior unchanged, including the suspended 403 banner, generic error alert, and password reveal. Restyled to sit under the intro.
4. **Trust row** — three minimal feature chips with small Lucide icons and muted borders:
   - `الاشتراكات` (icon `ReceiptText`)
   - `تنبيهات الانتهاء` (icon `CalendarClock`)
   - `المدفوعات` (icon `CircleDollarSign`)
   - Social-proof line below chips: `يثق به كثير من أصحاب الأعمال` (generic, no numbers/logos), with a star/`Star` icon.
5. **Footer** — existing `تم التطوير بواسطة تسهيل` link to `/about` (kept as-is).

## Identity details
- Neutral palette: foreground / muted-foreground / border. No gradients, no colored logo.
- Wordmark is the focal point; generous vertical spacing.
- Works in light and dark mode via existing CSS variables.

## Copy — new `login` section in `strings.ts`
```ts
login: {
  brandName: "مدير الحسابات المشتركة",
  tagline: "نظّم حساباتك المشتركة وعملاءك واشتراكاتك في مكان واحد",
  intro: "منصة متكاملة لإدارة الحسابات المشتركة: تتابع الاشتراكات، تنبّهك قبل انتهائها، وتنظّم مدفوعات عملائك.",
  featureSubscriptions: "الاشتراكات",
  featureExpiry: "تنبيهات الانتهاء",
  featurePayments: "المدفوعات",
  socialProof: "يثق به كثير من أصحاب الأعمال",
},
```

## Out of scope
- No change to auth/login/register/suspend logic or API.
- No specific customer counts, testimonials, or logos.
- No changes to the in-app layout or other pages.

## Verification
- `pnpm --filter @workspace/accounts-manager run typecheck` passes.
- Login page renders the brand band, intro, form, trust row, and footer in both light and dark mode; login/register/demo toggles and the suspended banner still work.
