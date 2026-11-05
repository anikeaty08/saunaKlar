# David edition: plan and approach

Status: plan only, no code yet. Written 2026-11-05.

This plan describes a single-reseller version of saunaKlar for one store owner, David. It runs in
David's store, and it is the product we show to wholesalers afterwards. The big multi-layer
platform (manufacturer, resellers, customers) in this repo stays as it is.

Everything marked **verified** was checked in this repo's code. Everything marked
**assumption** was not, and needs a confirmation from you.

---

## 1. Goal

1. David signs in, builds a quotation with the customer in the store, and shares a view-only
   link with that customer.
2. The customer can look at the sauna (3D, outside and inside) and the price, but cannot change
   anything. Changes go through David.
3. David sees who opened which link, how often, and a simple "how likely is this to sell" score.
4. The big platform's code is not touched by David's work. David gets his own repository and
   his own hosting, and we keep access to ship updates.

## 2. Approach: separate repo, but "switch off" instead of "delete"

You suggested cloning the repo and deleting the wholesaler parts. I agree with the separate
repo. I suggest one change to the method: **turn the multi-tenant parts off with a
single-reseller setting rather than deleting them**, at least at the start.

Why: the data model is built around a reseller row. Every tenant table carries `reseller_id`,
row-level security reads `app.reseller_id`, and prices come from the manufacturer
(**verified**: `packages/db/migrations/0002_tenancy_identity.sql`, `0004_reseller_catalog.sql`,
`packages/pricing/src/index.ts`). Deleting the manufacturer and reseller layers means rewriting
the schema, the pricing engine and most API routes. Keeping them and running with exactly one
manufacturer row and one reseller row ("David") means very little changes underneath.

| | Switch off (recommended) | Delete the layers |
|---|---|---|
| Work to start | Small: seed one reseller, hide screens, map David's domain | Large: schema, pricing, RLS, routes, tests |
| Bringing fixes over from the big repo | Easy: the shared code is still the same shape, so `git cherry-pick` mostly works | Hard: every fix has to be re-done by hand |
| Risk of breaking working things | Low | High |
| Leftover unused code in David's repo | Yes (manufacturer admin, sign-up pages) | No |
| What David's repo exposes | More of our platform's code | Less |

Later, once David's version is stable, unused parts can be deleted in small steps.

How the repo would be made (**assumption**, to confirm): create a new private repo (name from
you), push this repo's full history into it, and add the big repo as a second remote called
`upstream`. Fixes made in the big repo can then be pulled across with `git cherry-pick`. A
GitHub "fork" also works but stays linked to the original repo, so a plain new repo is simpler.

## 3. What exists today, and what happens to it

### Reused as it is

| Part | Where (verified) | Notes |
|---|---|---|
| 3D configurator, construction kit, outside and inside views | `apps/web/src/three/`, `apps/web/src/three/kit/`, `apps/web/src/storefront/pages/Configure.tsx` | Exterior/Interior tabs exist (`ViewerSlot` `views` prop). |
| Option rules (required, excludes, single/multi) | `packages/rules/src/index.ts` | `toggle` pulls in required options and drops conflicting ones, so the model "adjusts automatically". |
| Pricing engine (integer, per currency, discounts) | `packages/pricing/src/index.ts` | Live price while configuring. |
| Currencies and languages | `packages/db/migrations/0010_reference_data.sql` (EUR, CHF, SEK, NOK, DKK, PLN, CZK, GBP), `packages/shared/src/common.ts` (`en, de, fr, it, rm`) | One currency per reseller (`resellers.currency_code`). |
| Staff sign-in with MFA | `services/api/src/routes/staffAuth.ts`, `apps/web/src/staff/` | David's login. |
| Price freezing when shared | `lockConfiguration` in `services/api/src/domain/configurations.ts` | Snapshot of price and option lines. |
| Share links: random 256-bit token, only the hash stored, expiry, revoke | `services/api/src/domain/sharing.ts`, `routes/admin.ts` (`adminCreateShareLink`, `adminRevokeShareLink`) | Staff can already choose `expiresInDays` (1 to 90). |
| Basic view tracking | `share_link_views` table (time + device class) | Count and last-viewed shown in admin. |
| Branding (logo, colour), storefront layouts, look and feel | `apps/web/src/storefront/admin/Branding.tsx`, `layouts/` | You want things to look the same, so this stays. |
| Reports base | `adminAnalytics` in `routes/admin.ts`, `apps/web/src/storefront/admin/Dashboard.tsx` | Totals, daily chart, top saunas. |
| Deployment (AWS, Terraform) | `infra/`, `.github/workflows/deploy*.yml` | Region `eu-central-1`. |

### Changed

| Part | Today (verified) | For David |
|---|---|---|
| Shared link page `/s/:token` | `apps/web/src/storefront/pages/Shared.tsx` lets a signed-in customer **claim** the configuration, clone it and open it in the configurator | View only: 3D, inside view, option list, price, David's comments, "call David" button. No claim, no edit, no sign-in. |
| Inside view on the shared page | Shared page renders `ViewerSlot` without `views`, so no Exterior/Interior tabs | Turn the tabs on so the customer can look inside. |
| Staff configuration screen | `apps/web/src/storefront/admin/Configurations.tsx` edits options as a list; the 3D configurator is only on the customer storefront | David needs the full 3D configurator inside his admin, because he configures with the customer. |
| Customer record | `customers` needs an e-mail-verified account to be ACTIVE; no organisation field. Staff can only attach ACTIVE customers to a configuration | A "contact" David types in himself: person, organisation, e-mail, mobile. No account, no verification e-mail. |
| Quote | A quote today belongs to a **customer request** (`request_quotes`, status flow SUBMITTED → … → ACCEPTED in `packages/shared/src/requests.ts`) | A quote is started by David: number (e.g. Q-1024), contact, quantity, configuration, comments, versions. |
| Link expiry | Range 1 to 90 days, enforced in the database (`share_links_expiry`), default from `resellers.default_share_expiry_days`. Price snapshot is valid 30 days (`SHARE_PRICE_VALID_DAYS`) | David picks the duration when creating the link. Link expiry and price validity must line up (see risks). |
| Tracking | Time and device class only, **no IP** stored | Add IP, user agent, repeat visits, time spent, whether the inside view was opened. Exclude David's own opens. |

### Hidden (switched off, not deleted at first)

| Part | Where (verified) |
|---|---|
| Manufacturer admin app | `apps/web/src/manufacturer/`, `services/api/src/routes/manufacturer.ts`, `functions/manufacturer-admin.ts` |
| Platform landing page (recruiting resellers) | `apps/web/src/platform/` |
| Customer sign-up, account pages, saved configurations, customer requests | `apps/web/src/storefront/account/`, `services/api/src/routes/account.ts`, `routes/auth.ts`, `routes/configurations.ts` |
| Multiple resellers / subdomains | Host parsing in `packages/shared/src/host.ts`, `apps/web/src/host.ts`: David gets one fixed domain |
| Reseller discount caps set by a manufacturer | `reseller_*_discounts`, `maxDiscountBps`: only relevant if a wholesaler sets David's prices (open question 4) |

### New (does not exist today)

| Feature | Verified missing |
|---|---|
| Watermark on 3D and on downloads | No "watermark" anywhere in the code |
| Downloads: image, itemised list, cost and comments (PDF) | No PDF or image export found |
| Contact capture with organisation and quantity | Not in schema |
| Quote numbers and versions | Not in schema |
| IP and detailed link tracking | Not in schema |
| Purchase-likelihood score | Not present |
| Command box | Not present |
| Custom line items (delivery, installation, special requests) | Pricing engine only knows base price, options and one discount |
| Payments and invoices (phase 2) | Not present |

## 4. David's feature list (from your picture)

### Phase 1

1. **Login.** David (and staff, if any) sign in. Existing staff login with MFA.
2. **New quotation.** David starts a quote, picks or creates the contact.
3. **Pick a model.** From the catalogue.
4. **Configure.** All option groups, model updates live, price updates live, rules block
   invalid combinations, "ready" only when validation passes (existing `validate`).
5. **Watermark** on the live 3D view and on every download (see section 5).
6. **Downloads of the offer:**
   - image of the configured sauna,
   - itemised list (each option with its price),
   - cost and comments (totals, quantity, discount, David's notes).
   Probably one PDF with all three, plus a separate image. **Assumption:** to confirm.
7. **Share link.** Before creating it, David enters name (person, organisation), e-mail, mobile,
   quantity, and the expiry. The picture asks "add payment info or not?": I suggest **not** in
   phase 1. Taking card or bank details belongs with phase 2 payments and brings extra legal and
   security rules.
8. **Customer opens the link.** View only. Can rotate, look outside and inside, see options and
   price, cannot change anything, sees a "call David" button.
9. **Tracking.** Opens, repeat opens, IP, device, time on page, inside view opened or not.
10. **Purchase likelihood.** A rule-based score from the tracking data (section 6).
11. **Command box.** Commands like `new quote`, `find Müller`, `open Q-1024`, `list open quotes`,
    `list expiring links` (section 7).
12. **Reports and lists.** Quotes by status, link activity, top models, conversion, expiring
    quotes.

### Phase 2

13. Payment integration.
14. Invoice generation.

## 5. Customer link: security and privacy

- **Token:** random 256-bit, only the hash stored (already the case). Nobody can guess a link,
  and a leaked database does not leak working links.
- **Expiry:** David picks it. After expiry the page shows "this offer has expired, call David"
  (the expired page exists today).
- **Revoke:** David can withdraw a link at any time (exists).
- **Versioned quotes:** when David changes a quote, it becomes version 2. The old link either
  keeps showing version 1 or is revoked and a new link sent. A customer must never see prices
  change under an open link without David knowing. **Decision needed** (question 9).
- **Watermark, honestly:** a watermark drawn in the browser over the 3D view stops casual
  copying but anyone can take a screenshot, and code running in the browser can be bypassed.
  For **downloads**, the watermark should be added on the **server** when the file is made, so
  the file that leaves the system always carries it. The live 3D watermark is a deterrent, not
  protection. The full-quality 3D files are already served through signed cookies bound to the
  host (`services/api/src/routes/assets.ts`).
- **Privacy:** storing IP addresses and customer contact details is personal data. The servers
  are in the EU (`eu-central-1`) and CHF and EUR are supported, so GDPR and the Swiss data
  protection act likely apply (**assumption:** depends on where David's store is). Needed: a
  short privacy notice on the link page, a retention period for tracking data (for example 12
  months), and a way to delete a contact. The existing retention worker
  (`services/api/src/worker/retention.ts`) is a place to add that. Storing a shortened IP, or the
  city it maps to, is safer than the full IP.
- **No customer accounts:** removing sign-up also removes password resets, verification mails
  and account takeover risks for the customer side.

## 6. Purchase likelihood: keep it simple and explainable

With one store and no history there is no data to train a model on, so this should be rules with
points, and David sees why a quote scored what it did. Example (numbers are a starting point to
tune with David):

| Signal | Points |
|---|---|
| Link opened at least once | +20 |
| Opened again on a later day | +15 per day, max +30 |
| Inside view opened | +10 |
| More than 2 minutes on the page | +10 |
| Opened from more than one device or IP (sharing with family) | +15 |
| Opened within 24 h of sending | +10 |
| Not opened after 3 days | −20 |
| Expiry within 3 days and no open | −10 |

Shown as Low / Medium / High with the reasons listed. Once some quotes have been won or lost,
the points can be checked against real outcomes.

Known noise: link previews in WhatsApp, Outlook "safe links" and similar scanners can open a link
automatically. Today a view is recorded only when the page's JavaScript calls the API
(`routes/catalog.ts`, `routes.shared`), which most preview bots do not run, but some scanners do.
David's own opens (signed-in staff) must not count.

## 7. Command box

A search box on every admin screen, opened with Ctrl+K (Cmd+K on Mac) or a button. Fixed
commands, not free AI chat, so it is fast and predictable:

| Type | Does |
|---|---|
| `new quote` / `new quote Müller` | Starts a quote, optionally with that contact |
| `find <text>` | Searches contacts, organisations, quote numbers |
| `open Q-1024` | Opens that quote |
| `list open` / `list won` / `list expiring` | Filtered quote lists |
| `share Q-1024` | Opens the share dialog for that quote |
| `report month` | Opens the monthly report |

Plain typing without a command searches. An AI assistant that understands free text can be added
later on top of the same commands if David wants it.

## 8. How other companies do this

This kind of tool is usually called **CPQ** (configure, price, quote). Companies that sell
configurable products through a showroom or sales rep (furniture, kitchens, windows, cars, solar
and similar) generally work like this:

1. The **salesperson** drives the configurator with the customer. Customers rarely build the
   final order alone; they get a proposal. This matches David's rule.
2. Each quote has a **number, a version, and a validity date**. Changes create a new version
   instead of overwriting.
3. The quote has **extra lines** next to the configured product: delivery, installation, removal
   of an old unit, discounts, special requests.
4. Discounts above a limit often need **approval**. For a single owner this does not apply, but
   it will matter when a wholesaler has many resellers.
5. The customer gets a **proposal link or PDF**. Proposal tools such as PandaDoc or DocSend
   show the sender when and how often the document was opened. This is the same idea as David's
   tracking.
6. The customer **accepts** online (button or signature), then pays a deposit. That is phase 2.

What this means for the plan: the main gaps compared to that usual flow are quote versions,
extra line items, quantity, and an "accept" step. They are in the plan above.

## 9. Delivery model

- **Repo:** a new private repo for David's version, separate from this one. We keep admin access
  to ship updates.
- **Hosting:** this repo deploys to AWS with Terraform (Aurora/RDS, Cognito, S3, CloudFront,
  WAF, Lambda, SES, SQS: `infra/modules/`). That is sized for a platform with many resellers. For
  one store it works but has a fixed monthly cost even when idle. A smaller setup is possible
  later but is extra work. **Assumption:** we start with the same AWS setup and a smaller database
  size; decision needed (question 6).
- **Environments:** one test copy for us and one live copy for David's store.
- **Updates:** fixes go to the big repo first when they are shared code, then get picked into
  David's repo; David-only features go only to David's repo.
- **Store hardware:** the 3D view runs in the browser. The tablet or PC in the store should be
  tested early for speed (**assumption:** not tested yet).

## 10. Open risks and loopholes in the current idea

1. **Code ownership.** If David receives the repository, he has our code and could take it to
   someone else or stop paying. Usually the vendor keeps the repo and hosting and David gets the
   running app plus a contract. Decide before handing over (question 2).
2. **Two codebases drift.** Every fix may need doing twice. The switch-off approach and the
   `upstream` remote keep this small, but someone has to do it.
3. **Prices.** In the big app the manufacturer sets list prices and caps discounts. In David's
   version someone has to own the price list. If prices are wrong, every quote is wrong.
4. **Link expiry vs price validity.** Prices freeze for 30 days today, links can live up to 90.
   A customer could open a link showing a price that is no longer honoured. The link expiry
   should never be longer than the price validity.
5. **Quantity and extra lines.** The pricing engine has no quantity and no free lines today. The
   itemised PDF will look incomplete without delivery and installation.
6. **Customer changes by phone.** Every change is a new version. Without versions, David cannot
   tell what the customer saw.
7. **Tracking and the law.** IP tracking without a privacy notice can be a problem in the EU and
   Switzerland. Needs David as the responsible party, and a notice on the page.
8. **Watermark expectations.** It cannot stop screenshots. It should be presented to David as a
   deterrent and a branding mark.
9. **Score expectations.** The score is a hint, not a forecast, until there is history.
10. **Demo vs live.** The preview/demo build uses mock data (`apps/web/src/api/mock.ts`,
    loaded from `apps/web/src/main.tsx`). The store version must run against the real database
    and API, which means real hosting, backups and a real login.

## 11. Order of work (when you say go)

1. Create David's repo, single-reseller seed, hide manufacturer and customer-account screens,
   fixed domain. Deploy to a test environment.
2. Contacts and quotes (number, version, quantity, comments, extra lines), 3D configurator inside
   David's admin.
3. View-only share page with inside view, expiry chosen by David, call button.
4. Tracking (IP, repeats, time, inside view) and the likelihood score.
5. Watermark on 3D, server-side downloads (image and PDF).
6. Command box, reports and lists.
7. Test in the store on David's device, fix, go live.
8. Phase 2: payments and invoices.

## 12. Where the work lives

The code lives on GitHub (`anikeaty08/saunaklar`). Each Claude session clones it fresh into a
temporary cloud machine, works on a branch, and pushes back. Nothing is saved on your computer
unless you connect a folder. GitHub is the safe copy. You can keep working this way. Connecting a
local folder is only useful if you want to run the app on your own PC or hand files over
directly.

---

## 13. What I need from you

1. **Name for David's repository** (for example `saunaklar-david`), and whether it is under your
   GitHub account or an organisation.
2. **Who owns the code and hosting:** you (David gets access to the app only) or David (he gets
   the repo). And whether David gets read access to the repo at all.
3. **David's business details:** store name, country and address, the one currency and the
   languages his customers use, VAT rate and whether prices are shown with or without VAT.
4. **Who sets prices:** David himself, or a wholesaler/manufacturer price list he follows. And the
   real price list: base prices per model and per option, in his currency.
5. **Which models and options** David sells (all six catalogue models, or a subset), and any
   rules missing today (for example "this heater only with this size").
6. **Hosting choice:** same AWS setup as the big app (an AWS account, region, budget), or a
   cheaper simpler host. And who pays the hosting bill.
7. **Domain** for David's app and for the customer links (for example `offers.davidsauna.ch`),
   and access to its DNS.
8. **Branding:** logo (SVG or high-resolution PNG), colours, and the watermark text or logo.
   Should the watermark also show the quote number?
9. **Quote versions:** when David changes a quote, should the old link keep showing the old
   version, or be withdrawn automatically?
10. **"Clean image" meaning:** an image without the app's buttons but still watermarked, or an
    image without watermark that only David can download?
11. **Extra lines on quotes:** delivery, installation, other? Can David give a manual discount
    or override the total?
12. **Staff:** only David, or more people in the store? Each with their own login?
13. **E-mail or WhatsApp:** how does David send the link? We can generate it to copy, or send an
    e-mail from the app (needs a sender address on his domain).
14. **Privacy text:** who writes the privacy notice (David's lawyer, or we draft it for review),
    and how long tracking data is kept.
15. **Store device:** which tablet or PC will run it, so we can test speed early.
16. **Phase 2 provider preference** for payments (for example Stripe, or a local provider) and
    invoice format rules in David's country. Not needed now, only to keep room in the design.
