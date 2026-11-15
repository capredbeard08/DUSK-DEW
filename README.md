# DUSK & DEW — international storefront + Founder Console

A working ecommerce and operations platform for a Nigerian-founded skincare brand: public
storefront, product and ingredient catalogue, waitlist/preorder flows, physical inventory with
automatic post-payment deduction, production batches, order fulfilment, analytics, audit logging
and a private Founder Console.

Built as a **Cloudflare Worker (ES modules) + D1 (SQLite) + static assets**, server-rendered with
no client framework. That keeps every price, stock decision and permission check on the server.

---

## 1. Platform reality and limitations

| Capability | What is actually implemented |
| --- | --- |
| Hosting | Cloudflare Workers-compatible bundle + static assets. Deploy manifest: `freebuff.deploy.json`. |
| Database | Cloudflare D1. Schema is created and seeded idempotently on first request (`src/lib/bootstrap.js`). |
| Auth | First-party, server-side. PBKDF2-SHA256 (100k iterations — Cloudflare WebCrypto rejects higher counts; hashes carry their own count so this can be raised elsewhere), hashed session tokens, HttpOnly cookies, CSRF, rate limits, RBAC. |
| Payments | Paystack and PayPal server-side session creation, signed webhook verification, server-side return verification, idempotent event ledger, refunds. Disabled until the founder enables it. |
| Email | Resend API when `RESEND_API_KEY` + `EMAIL_FROM` are configured. Otherwise messages are recorded in an outbox as `skipped`. No sending domain is invented. |
| Images | Product image URL field plus generated amber-glass SVG artwork. There is **no** binary upload UI; put files behind a CDN and paste the URL. |
| Currency | USD display with per-product currency field. GBP/EUR are architecturally supported but **no FX conversion is implemented** — a product priced in another currency is refused at checkout rather than converted. |
| Search | Server-side catalogue filtering/sorting. Suitable for a boutique catalogue; large catalogues should move filtering into SQL/FTS. |
| Bots/abuse | Fixed-window rate limits in D1 + honeypot fields. A Cloudflare WAF rate-limit rule is still recommended at the edge. |
| Backups | D1 point-in-time recovery (Cloudflare) plus CSV exports for orders, inventory, analytics and audit. |
| Testing | Node's built-in SQLite drives a D1-compatible shim, so the real routes and SQL execute in tests. See §7. |

**Not built / deliberately out of scope:** cryptocurrency payments, Apple Pay/Google Pay wallet
buttons (they depend on provider eligibility and merchant configuration; Paystack/PayPal hosted
checkout covers card wallets where the provider enables them), automatic carrier tracking,
multi-warehouse stock, and any invented customs/duty calculation.

### Demonstration content warning

The seeded catalogue exists so the storefront and console are usable immediately. Its copy, INCI
lists and claims are **placeholder demonstration content**, flagged `Pending founder verification`
in the console. Per the brief, only founder-approved information may be published: review each
product and ingredient, correct the INCI declarations, then set **Ingredient status → Founder
verified**. The seeded `DD-0001` order is labelled as a demonstration order.

---

## 2. Local development

Requires Node 22.5+ (uses the built-in `node:sqlite` for the local D1 shim).

```bash
npm install
npm run dev        # http://localhost:3000  (SQLite file: data/dev.sqlite)
npm test           # full acceptance suite
npm run check      # syntax check every module
npm run build      # dist/worker.js for deployment
```

Optional: copy `.env.example` to `.env`. Never commit `.env`.

### Founder Console

`/admin/login`

First-run account (created only when the database is empty):

- Email: `FOUNDER_EMAIL` or `founder@duskanddew.com`
- Password: `FOUNDER_PASSWORD` or `DuskAndDew!2026`

The first sign-in is redirected to a mandatory password change before the console opens. Set
`FOUNDER_EMAIL` and `FOUNDER_PASSWORD` in the environment **before** the first request in
production.

---

## 3. Environment variables

| Variable | Purpose |
| --- | --- |
| `FOUNDER_EMAIL`, `FOUNDER_PASSWORD` | Bootstrap founder account (first run only). |
| `APP_ORIGIN` | Public origin used for payment callbacks and console webhook URLs. |
| `PAYSTACK_SECRET_KEY` | Paystack API + webhook HMAC secret. |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_MODE` | PayPal Checkout and webhook verification. |
| `PAYMENT_WEBHOOK_SECRET` | Fallback webhook secret when no Paystack key is set. |
| `PAYMENTS_OFFLINE` | **Sandbox only.** `1` exposes `/pay/:reference` to simulate a verified capture. Never set in production. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email. Without both, mail is recorded as `skipped`. |

Only providers that are configured in the environment **and** enabled by the founder appear at
checkout. Secrets never reach the browser, logs or templates.

---

## 4. Business rules enforced in code

- **Available stock = physical − reserved.** Reserved units belong to unpaid orders for 30 minutes.
- Checkout reserves stock with a guarded `UPDATE … WHERE physical - reserved >= qty`, so two
  simultaneous buyers cannot oversell the last unit.
- Stock is deducted **only** after a verified payment, using the exact quantity purchased, once per
  order. Duplicate webhooks are rejected by a unique `(provider, event_id)` key.
- Failed payments and abandoned checkouts release reservations. Expired reservations are released
  automatically, with a ledger entry, when the inventory screens load.
- Every stock change writes an append-only `inventory_movements` row (sale, restock, adjustment,
  release, batch receipt, refund return).
- Out-of-stock transitions are automatic; restocking restores sale availability unless the founder
  has marked the product manually unavailable.
- Preorders live on `batch_items` (`allocated_qty`, `preorder_qty`, `preorder_holds`) and can never
  exceed the founder-approved allocation. Physical stock changes only when a batch receipt is
  confirmed.
- Payments, refunds, orders and movements are never deleted. Products are archived.
- Everything in the console is a server-rendered form with CSRF + role checks; actions are written
  to `audit_logs`.

---

## 5. Module map

```
src/
  index.js              Worker entry + routing + webhooks
  db/schema.js          D1 schema (tables, constraints, indexes)
  db/seed.js            Idempotent first-run seed (demo catalogue, founder, settings)
  lib/bootstrap.js      Schema + seed on first request
  lib/security.js       PBKDF2, sessions, CSRF, rate limits, RBAC, escaping
  lib/inventory.js      Reservation, commit, release, restock, adjust, batches
  lib/payments.js       Provider sessions, signed webhooks, idempotency, refunds
  lib/email.js          Templates, outbox, Resend delivery
  lib/reports.js        Dashboard + analytics aggregates
  lib/http.js           Responses, page context, catalogue, CSV
  routes/public.js      Storefront, waitlist, checkout, order lookup, sandbox capture
  routes/account.js     Registration, sign-in, orders, addresses, password
  routes/admin.js       Console auth, overview, products, inventory, restocking
  routes/admin-sales.js Orders, customers, preorders, production batches
  routes/admin-system.js Analytics, content, notifications, payments, shipping, users, audit, settings, exports
  views/                Server-rendered HTML (public, account, console, design system)
public/                 styles.css, app.js (bag), favicon.svg
scripts/                dev server, D1 shim, build, check, smoke
tests/                  Acceptance suites (inventory, payments, security, console)
```

---

## 6. Founder workflows (all without code)

- **Product:** create/edit/archive, SKU, price/currency/cost, INCI, directions, warnings, claims,
  shipping text, categories, sizes, image URL, low-stock threshold, fulfilment model, preorder
  toggle, manual unavailability, publication status, verification status, featured flag.
- **Inventory:** overview (physical/reserved/available/sold/threshold/value), per-product ledger,
  restock, adjustments with mandatory reason, reservations, CSV export.
- **Restocking:** per-product or bulk page, supplier, batch reference, unit cost, date, notes.
- **Orders:** search/filter by reference, customer, dates, payment and fulfilment status; update
  fulfilment, tracking and carrier; issue full/partial refunds; internal notes; export.
- **Preorders/waitlist:** batch allocations against remaining capacity, preorder orders, waitlist
  and "mark notified" (queues the restock email).
- **Production batches:** create, assign products, allocation, manufacturer, dates, quality
  approval, receive into inventory (one-time, audited).
- **Analytics:** date range, gross/refunds/net, AOV, paid vs pending, product performance with
  margin, sales by country, restock cost, valuation, turnover, conversion, CSV export.
- **Content:** home, philosophy, story, policies, contact intro, announcement.
- **Notifications:** template editor, outbox, deliver queued.
- **Payments:** enable/disable, preferred provider, readiness checks, webhook URLs, activation
  checklist.
- **Shipping:** per-country enable, charge, delivery estimate, customs note.
- **Users:** create founder/admin/staff with temporary passwords, disable accounts (last founder
  protected), capability matrix.
- **Audit:** searchable, exportable administrative history.
- **Settings:** store identity, support email, currencies, socials, global preorder authorisation.

---

## 7. Test evidence

`npm test` runs the real Worker routes against an in-memory SQLite database through a D1-compatible
adapter (`scripts/d1-shim.mjs`), so SQL constraints, guarded updates and transactions execute for
real.

| Suite | Covers |
| --- | --- |
| `tests/inventory.test.mjs` | Brief Tests 1–10: 100→99, 99→96, failed payment unchanged, duplicate webhook idempotent, restock 50, final-unit sell-out and auto status, oversell blocked, concurrent last-unit race, reservation expiry release, preorder allocation + batch receipt. Plus manual unavailability and automatic reactivation. |
| `tests/payments.test.mjs` | Successful payment, success-page-only cannot pay, failed payment, invalid and wrong-secret webhooks, duplicate events, partial then full refunds, refund over captured amount, paid-but-unfulfillable order flagged for the founder. |
| `tests/security.test.mjs` | Unauthenticated/console role denial, unauthorised stock changes, CSRF rejection, staff refund denial, order privacy, secret non-exposure, invalid forms, rate limiting, PBKDF2 + hashed session tokens, SQL injection treated literally, XSS escaping, payments cannot be enabled without credentials, waitlist mode charges nothing. |
| `tests/console.test.mjs` | Product create/update/archive, opening stock, adjustment reason enforcement, restock cost, fulfilment with tracking + notifications, private notes, content publishing, analytics + CSV exports, audit coverage, waitlist notify, payment enablement, founder self-lockout protection. |

Latest local run: **4 suites, all passing** (`node --test --test-concurrency=1 tests/`).

Verification that is **not** done: browser/visual review, real Paystack/PayPal sandbox transactions
(no merchant credentials), real email delivery (no provider key), and a workerd/Miniflare run. The
Worker uses only Web APIs and D1, but publish a preview environment and complete the payment
sandbox check before enabling live payments.

---

## 8. Deployment

A **preview** environment has been deployed and verified (see §9). Production has not been
deployed, and paid checkout is still disabled. The brief requires founder approval before public
production deployment and before paid checkout is enabled.

When approved:

1. `npm run build` → `dist/worker.js`.
2. Deploy `freebuff.deploy.json` (assets from `public/`) to Freebuff Sites or Cloudflare, with a D1
   binding named `DB`.
3. Set secrets for the target environment; set `APP_ORIGIN` to the deployed origin.
4. First request applies the schema and seeds the founder account. Sign in, change the password.
5. Configure shipping destinations and charges, verify the catalogue, then (only with sign-off)
   enable payments and point the provider webhooks at:
   - `POST /webhooks/paystack`
   - `POST /webhooks/paypal`
6. Complete a sandbox transaction, refund and duplicate-webhook check against the deployed origin.

### Preview deployment (verified)

- **Preview:** `https://site-88f08e0dc6a04ec38efc2d79fc1d7353.freebuff.page` — published preview
  environment, fresh D1 database, production untouched.
- **Secrets bound:** `FOUNDER_EMAIL`, `FOUNDER_PASSWORD`, `PAYMENT_WEBHOOK_SECRET`. The generated
  preview founder password is in `.preview-founder-password` (gitignored); rotate it before sharing
  the URL. Sandbox capture (`PAYMENTS_OFFLINE`) is deliberately **not** enabled.
- **Checks:** 19/19 (`scripts/verify-preview.mjs`): health, home, catalogue, product, static assets,
  console auth redirect, founder sign-in, every console module, payments disabled, no secret in HTML,
  unsigned webhook rejected with 401, waitlist write + redirect.
- **Platform issues found on the real runtime and fixed:** D1 `exec` cannot apply the
  multi-statement schema (now chunked atomic batches with per-statement fallback); Cloudflare
  WebCrypto caps PBKDF2 at 100,000 iterations (was 210,000); a partially completed seed is now
  repaired instead of skipped; signed-in visitors could not submit public forms (session CSRF is
  now accepted alongside the guest cookie, with a regression test).
- **Still blocked:** Paystack sandbox payment, refund and duplicate-webhook verification. No
  merchant credentials exist. Add `PAYSTACK_SECRET_KEY` (test key) in Sites → Secrets, redeploy,
  register `https://<preview-host>/webhooks/paystack` in the Paystack dashboard, then enable
  payments in **Payments settings** and run a test transaction plus a partial/full refund.

### Before enabling live payments

- [ ] Merchant account approved for currency/destinations.
- [ ] Webhook signature verified against the deployed origin.
- [ ] Product copy, INCI, claims verified by the founder.
- [ ] Shipping charges and customs language confirmed.
- [ ] Refund policy accurate.
- [ ] Email domain verified and confirmation emails tested.
- [ ] Backup/export routine agreed.
- [ ] Founder sign-off recorded.
