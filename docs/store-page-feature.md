## **Feature: Public Store Page per Organization** 

## Summary 

Each organization (store) gets a simple, public-facing landing page that displays their available products with pricing. When a customer wants to buy, they tap a button that forwards them to the store's preferred messaging channel (WhatsApp, Telegram, etc.) with a pre-filled message. 

No cart. No checkout. No payment processing. Just a clean product catalog with a directmessage CTA. 

## Why 

The SaaS currently only serves the back-office (management). The customer never interacts with the system. Adding a public store page means: 

- Store owners can share a single link instead of manually listing products in DMs 

- Reduces friction: customer sees products → taps "Order" → lands in WhatsApp with context 

- — 

- Makes the platform more than a management tool it becomes a sales channel too 

- Very low scope: it's just a read-only page with a messaging redirect, not a full e- commerce system 

## Scope (What It IS) 

- A public page per organization, accessible without login (e.g., /store/org-slug ) 

- Displays: store name, logo (optional), list of products with name, service, price, duration 

- Each product has an "Order" button that opens the store's configured messaging app (WhatsApp, Telegram, or custom link) with a pre-filled message like "Hi, I'd like to subscribe to [Product Name]" 

- Store owner configures their contact channel and message template in settings 

- Simple, mobile-first, fast-loading page 

## Scope (What It Is NOT) 

- No user accounts for customers 

- No cart or checkout flow 

- No payment integration 

- No custom domains (just a path under the main app domain) 

- No theme builder (one clean default design, maybe with color customization later) 

## Data Model Changes 

## New fields in settings table (per org): 

**==> picture [513 x 247] intentionally omitted <==**

**----- Start of picture text -----**<br>
Key Value Example Description<br>store_enabled "true" Whether the store page is live<br>store_slug "ahmad-subs" URL slug for the public page<br>store_contact_type "whatsapp" Contact channel type<br>store_contact_value "+962791234567" Phone number or username<br>"Hi, I want to subscribe to<br>store_message_template Pre-filled message template<br>{{product}}"<br>Display name (falls back to org<br>store_name_override "Ahmad's Store"<br>name)<br>store_description "Best shared accounts in Amman" Optional tagline<br>**----- End of picture text -----**<br>


No new tables needed. Products already exist and have name, service, price, duration. 

## API Changes 

## New public endpoint (no auth required): 

Plain Text 

```
GET /api/store/:slug
```

Returns: 

JSON 

```
{
"name": "Ahmad's Store",
"description": "Best shared accounts in Amman",
"contactType": "whatsapp",
"contactValue": "+962791234567",
"messageTemplate": "Hi, I want to subscribe to {{product}}",
"products": [
    {
"id": 1,
"name": "Netflix Premium",
"service": "Netflix",
"price": 3.5,
"durationDays": 30
    }
  ]
}
```

— Note: Only returns products from active accounts that have free slots (optional or just show all products regardless of availability). 

## Settings API update: 

The existing settings endpoints need to support the new store-related keys. No structural change needed since settings is already a key-value store. 

## Frontend Changes 

## 1. Public Store Page (new route, no auth) 

Route: /store/:slug 

A standalone page (outside the dashboard layout) that: 

- Fetches GET /api/store/:slug 

- Renders the store name, description, and product grid 

- Each product card shows: name, service icon/label, price, duration 

- "Order" button generates the contact link: 

   - WhatsApp: https://wa.me/{number}?text={encoded_message} 

   - Telegram: https://t.me/{username}?text={encoded_message} 

   - Custom: just opens the configured URL 

- Mobile-first, clean design, fast load 

## 2. Store Settings (in admin dashboard ) 

Add a section in the existing Settings page where the org admin can: 

- Enable/disable the store page 

- Set their slug (with uniqueness validation) 

- Choose contact type (WhatsApp / Telegram / Custom link) 

- Enter contact value 

- Customize the message template 

- Preview the store page link 

## Implementation Steps 

1. Backend: Add store settings keys — seed defaults, add validation for slug uniqueness 

2. Backend: Create GET /api/store/:slug endpoint — public, no auth, returns org products + contact info 

- 

- 3. Frontend: Build the public store page new route outside auth guard, fetches and renders products 

4. Frontend: Add store config section to Settings page — form for slug, contact type, message template 

- 

- 5. Test & polish mobile responsiveness, RTL support, edge cases (no products, store disabled, invalid slug) 

## SQLite Concern 

The store page is read-only and lightweight (one query per page load). SQLite handles — reads extremely well this won't cause any scaling issues. The page can also be cached aggressively since product data changes infrequently. 

## Future Enhancements (NOT in v1) 

- Custom colors/branding per store 

- Product availability indicator (slots remaining) 

- Store analytics (page views, click-through to WhatsApp) 

- Custom domain support 

# • SEO meta tags per store 

