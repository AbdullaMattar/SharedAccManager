# Public Store Page Per Organization Design

## Goal

Add a lightweight public store page for each organization so customers can browse products and contact the store through WhatsApp. The feature stays read-only for public visitors: no cart, no checkout, no payment flow, and no customer accounts.

## Scope

This design replaces the rough draft in `docs/store-page-feature.md` with the agreed v1 behavior.

In scope:

- Public route at `/store/:slug`.
- Public product catalog for an organization.
- Product availability labels.
- WhatsApp CTAs for ordering or asking about unavailable products.
- Platform owner control over whether each org is allowed to use the website feature.
- Org admin control over the public store content and live/off state.
- Basic page metadata: document title and description.
- Typecheck/build verification only.

Out of scope:

- Cart, checkout, payments, customer login, or public sale creation.
- Telegram, custom contact links, or editable message templates.
- Logo upload or custom themes.
- Custom domains.
- Automated tests for this feature.
- Required dev-server or browser verification in the implementation plan.

## Ownership Model

There are two separate switches.

`store_platform_enabled` is controlled only by the platform owner from the platform admin area. It defaults to `true`. If this is `false`, the org cannot use the website feature, its public store returns `404`, and the org admin Website page shows a locked message.

`store_enabled` is controlled by the org admin from the org admin Website page. It defaults to `false`. It means the org wants its public store live.

The public store is visible only when all conditions are true:

- the organization status is `active`;
- `store_platform_enabled` resolves to `true`;
- `store_enabled` resolves to `true`;
- `store_slug` is valid and belongs to the organization;
- `store_whatsapp` is present and valid enough to build a WhatsApp link.

If any condition fails, `GET /api/store/:slug` returns `404`.

## Settings Storage

Use the existing `settings` table. No database migration is required.

Settings keys:

- `store_platform_enabled`: string boolean, default `"true"`, platform-only write.
- `store_enabled`: string boolean, default `"false"`, org-admin write.
- `store_slug`: public URL slug, org-admin write.
- `store_whatsapp`: dedicated store WhatsApp number, org-admin write.
- `store_name`: optional public display name, org-admin write. Falls back to organization name.
- `store_description`: optional public tagline, org-admin write.

Slug uniqueness is enforced in backend code by querying `settings` rows where `key = "store_slug"` and normalized `value` matches another organization. Because the settings table primary key is `(org_id, key)`, the database does not enforce global slug uniqueness.

## Validation

Slug rules:

- lowercase English letters, numbers, and dashes only;
- exact regex: `^[a-z0-9]+(?:-[a-z0-9]+)*$`;
- minimum length 3;
- maximum length 64;
- normalized to lowercase before save;
- unique across all organizations.

WhatsApp rules:

- org admin enters a dedicated WhatsApp number for the store;
- UI copy should ask for international format, for example `96279XXXXXXX`;
- backend normalizes by removing spaces, dashes, and a leading `+`;
- normalized value must contain digits only and be 8 to 15 digits long;
- the public page builds links as `https://wa.me/{normalizedNumber}?text={encodedMessage}`.

Store text rules:

- `store_name` max 120 characters after trim;
- `store_description` max 300 characters after trim;
- empty `store_name` falls back to organization name;
- empty description is omitted on the public page.

## Public API

Add a public route with no auth:

`GET /api/store/:slug`

Success response:

```json
{
  "name": "Ahmad Subs",
  "description": "Shared accounts in Amman",
  "whatsappNumber": "962791234567",
  "currency": "JOD",
  "products": [
    {
      "id": 1,
      "name": "Netflix Premium",
      "service": "Netflix",
      "price": 3.5,
      "durationDays": 30,
      "freeSlotCount": 2,
      "available": true
    },
    {
      "id": 2,
      "name": "Spotify Family",
      "service": "Spotify",
      "price": 2.5,
      "durationDays": 30,
      "freeSlotCount": 0,
      "available": false
    }
  ]
}
```

The response is safe public data only. It must not include account labels, provider credentials, customer data, subscription data, staff data, audit data, or internal organization status.

Products are sorted with available products first, then unavailable products. Within each group, sort by product `createdAt` ascending, then product `id` ascending.

Availability follows the slot-centered domain rule. A product is available when it has at least one `free` slot in an `active`, non-expired account owned by the same organization.

## Org Admin API

Add org-admin website endpoints guarded by `requireAuth`, `requireOrgUser`, and `requireAdmin`.

`GET /api/website`

Returns resolved website config for the current org:

```json
{
  "platformEnabled": true,
  "enabled": false,
  "slug": "ahmad-subs",
  "whatsapp": "962791234567",
  "name": "Ahmad Subs",
  "description": "Shared accounts in Amman",
  "publicUrl": "/store/ahmad-subs"
}
```

`PATCH /api/website`

Allows org admins to update:

- `enabled`;
- `slug`;
- `whatsapp`;
- `name`;
- `description`.

It must not allow org admins to update `store_platform_enabled`.

If `enabled: true` is requested while platform access is disabled, return `403`.

If `enabled: true` is requested without valid slug or WhatsApp settings, return `400`.

If slug is already used by another org, return `409`.

## Platform API

Add platform-owner website endpoints guarded by `requireAuth` and `requireSuperadmin`.

`GET /api/platform/websites`

Returns organizations and their platform website access state:

```json
[
  {
    "orgId": 1,
    "orgName": "Demo Organization",
    "orgStatus": "active",
    "platformEnabled": true
  }
]
```

`PATCH /api/platform/websites/:orgId`

Allows the platform owner to update only:

- `platformEnabled`.

When `platformEnabled` becomes `false`, the public store immediately returns `404`. The org admin's `store_enabled` value can remain saved, but it has no public effect until platform access is restored.

## Frontend Routes

Public route:

- `/store/:slug`, no `AuthGuard`, no dashboard layout.

Org admin route:

- `/admin/website`, inside `AuthGuard`, `OrgGuard`, and `AdminGuard`.
- Staff users do not see the page and cannot access it.

Platform owner route:

- `/platform/websites`, inside `AuthGuard` and `SuperadminGuard`.
- The screen manages website feature access for organizations only.

## Public Store Page

The public page is mobile-first and Arabic/RTL.

It renders:

- store name;
- optional description;
- product cards;
- availability badge;
- price and duration;
- WhatsApp CTA.

Available product CTA:

- label: `اطلب الآن`;
- message: `مرحباً، أريد الاشتراك في [product] بسعر [price] لمدة [duration] يوم.`

Unavailable product CTA:

- label: `اسأل عن التوفر`;
- message: `مرحباً، أريد الاستفسار عن توفر [product].`

The UI displays availability only, not exact slot counts. The API may return `freeSlotCount`, but public copy should not emphasize exact inventory counts in v1.

If `GET /api/store/:slug` returns `404`, render the existing not-found experience or a simple public not-found state.

## Org Admin Website Page

The org admin Website page includes:

- locked state if platform access is disabled;
- live/off switch;
- slug input and public link preview;
- dedicated WhatsApp number input;
- public store name input;
- optional description textarea;
- save action.

If platform access is disabled, show a clear locked message telling the admin the website feature is not currently available for their organization. Do not allow editing controls in that state.

The page should use existing shadcn/Radix components and strings from `artifacts/accounts-manager/src/lib/strings.ts`.

## Platform Websites Page

The platform Websites page is intentionally narrow.

It shows:

- organization name;
- organization status;
- whether website access is allowed;
- a toggle/action to allow or disable website access.

It does not edit slug, WhatsApp, name, description, or org live state. Those remain org-admin responsibilities.

## OpenAPI

Update `lib/api-spec/openapi.yaml` for the new website and public store endpoints. The project treats OpenAPI as the intended HTTP contract source of truth, even though some phase-three frontend calls still use local helpers.

Generated clients/schemas should be regenerated if the implementation plan changes generated API surfaces.

## Verification

The required verification for the implementation plan is:

- `pnpm --filter @workspace/api-server run typecheck`;
- `pnpm --filter @workspace/accounts-manager run typecheck`;
- `pnpm run typecheck`;
- `pnpm run build`.

No automated tests will be added for this feature. No dev-server or browser check is required by the plan.

Optional smoke checks after implementation:

- superadmin can disable website access for an org;
- disabled platform access makes `/store/:slug` return `404`;
- org admin sees a locked Website page when access is disabled;
- org admin can configure slug, WhatsApp, name, description, and enable the store when access is allowed;
- duplicate slugs are rejected;
- suspended organizations return `404`;
- available products appear before unavailable products;
- available and unavailable products use different WhatsApp messages.

## Risks

No automated tests means the riskiest areas are tenant isolation, slug uniqueness, and public store visibility rules. The implementation plan should keep backend helpers small and explicit so those checks are easy to inspect during code review.

Using the settings table keeps v1 fast and migration-free, but it means uniqueness is code-enforced. If public websites become a larger product area, a later migration to `organizations.store_slug` or a dedicated `store_profiles` table would be cleaner.
