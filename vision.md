# CFMembership — Vision

## What this is

CFMembership is an open-source, self-hosted membership platform built entirely on Cloudflare's developer platform. Clone it, configure your environment, run `wrangler deploy`, and you have a membership site with Stripe billing, magic-link auth, plan-based access control, and pluggable email integrations — all running on Workers, D1, and KV.

It is single-tenant by design. One deployment runs one site. No SaaS layer, no multi-tenancy overhead, no vendor lock beyond Cloudflare itself.

It is vanilla JavaScript, vanilla HTML, vanilla CSS. No build step required for the runtime. No React. No framework tax. The codebase should be legible to anyone who knows the web platform.

It is MIT licensed.

## The problem it solves

Most membership platforms are one of two things. Either they are expensive hosted SaaS products (MemberPress, Kajabi, Circle, Memberstack) that lock the site owner into the vendor's infrastructure, pricing, and roadmap. Or they are WordPress plugins that inherit WordPress's operational weight — database hosting, plugin conflicts, security patching, caching layers, PHP upgrades.

CFMembership is a third option: a small, readable codebase that runs on infrastructure the owner already understands, at Cloudflare's pricing (which for most small-to-medium membership sites is effectively free). The owner owns the code, owns the data, and owns the customer relationship. The platform's job is to disappear into the stack.

## Who it is for

The site owner is someone who is comfortable deploying to Cloudflare, or willing to learn. They want a membership site, not a content management system. They already have a way to author content — maybe a static site generator, maybe a headless CMS, maybe markdown in a repo, maybe they write HTML by hand. CFMembership does not care. It sits in front of the site as a routing layer and applies access rules based on URLs.

The end member is someone who signs up because they hit a page they wanted to read, got redirected to a paywall, liked the offer, and paid. They log in with magic links. They never have a password.

## Core architectural commitments

**URL-based access control.** The access model knows nothing about content. It knows URLs. A rule says "this URL pattern requires any of these plans." That is the entire conceptual model. The owner can use any content system that produces URLs.

**Exact plus prefix matching.** Rules are either exact URLs (`/about`) or prefixes (`/members/premium/*`). Most-specific match wins. This is enough expressiveness for real membership sites without inviting the regex footgun.

**Independent plans, not tiers.** Plans are not ranked Bronze-Silver-Gold with implied inheritance. Each plan is an independent bucket. A page can be made accessible to any combination of plans. A member with *any* matching plan gets access. This supports both traditional tiered models (by checking higher-tier plans on lower-tier content) and genuinely independent offerings (a "Podcast" plan and a "Newsletter" plan that share no content).

**Plan-owned redirects.** When someone without access hits a protected URL, they are redirected to the URL configured on the plan that gates the content. That redirect is, in practice, a sales page for the plan — a pitch plus a signup button. The site owner builds this page themselves; it is just another URL on the site. This means every paywall is a custom pitch for a specific offer, not a generic "please log in" screen.

**Cloudflare-native storage.** D1 holds the core relational data: members, plans, access rules, subscriptions, payment history. KV holds ephemeral and performance-sensitive data: active sessions, recent-page ring buffers, rate limit counters. Static site assets are served by the Worker. No external database, no external cache, no external session store.

**Pluggable email through a thin adapter contract.** Every transactional email goes through an adapter. The default is Cloudflare's outbound email feature. Resend and Kit (ConvertKit) are the other v1 adapters. The contract is minimal enough that community adapters for Postmark, Mailgun, SendGrid, or whatever else should take an afternoon to write. The Kit adapter also implements list sync so plan membership stays reflected in tags.

## The access model in detail

An access rule is a tuple: `(url_pattern, pattern_type, allowed_plan_ids[])`.

When a request arrives, the Worker finds all rules whose patterns match the requested URL and picks the most specific one. If no rule matches, the URL is public. If a rule matches and the requester is a member who holds any of the rule's allowed plans, access is granted. Otherwise the Worker issues a 302 redirect to the first allowed plan's redirect URL. (When a rule allows multiple plans, the first in a stable ordering wins the redirect — usually this will be the cheapest or most-prominent plan, which the owner orders intentionally.)

The "most specific" calculation is straightforward: exact matches beat prefix matches; longer prefixes beat shorter prefixes. `/blog/free-post` as an exact rule overrides `/blog/*` as a prefix rule. `/blog/premium/*` overrides `/blog/*`. This is the mechanism by which the owner's stated inheritance works: protect a category prefix, and every URL under it inherits the protection until a more specific rule overrides it.

Rules are authored in the admin UI against URL patterns. The owner does not need to predict every URL in advance; they protect prefixes and let new content under those prefixes inherit automatically.

## Authentication

Magic links only. No passwords, ever. When someone enters their email on the signup flow, the system creates a pending record, generates a single-use token, stores it in KV with a short TTL, and emails the link through the configured email adapter. Clicking the link exchanges the token for a session, also stored in KV, with a sliding expiration.

No password means no password reset flow, no password strength meter, no breach concerns, no hashing library, no account recovery except "send another magic link." The attack surface is the email account; the site owner is not responsible for protecting it.

## The signup flow

The flow is paywall-driven by design. A prospect browses the public parts of the site, eventually hits a protected page, and gets redirected to the relevant plan's sales page. That sales page — which the owner built — pitches the plan and contains a signup button.

The signup button initiates Stripe Checkout. Stripe-hosted, not embedded. Stripe captures the email, collects payment, handles Apple Pay and Google Pay and 3DS and everything else, and on success fires a webhook back to the Worker. The webhook provisions the member record, associates the Stripe subscription, and emails a magic link. The member clicks through and lands back on the site, now logged in and holding the plan.

This flow converts better than "sign up now, pay later" because the prospect never has a chance to abandon between account creation and payment. It also keeps CFMembership out of the business of collecting emails from people who never pay.

## Subscriptions and billing

Stripe is the source of truth for billing. CFMembership keeps a local mirror for query performance and display, but it updates the mirror from webhooks. The owner configures Stripe by pasting their API key into the admin once. From there, creating a plan in the admin calls Stripe's API to provision the Product, the Price, and the recurring configuration.

Members can upgrade themselves immediately, with prorated charges for the difference. Downgrades take effect at the end of the current billing period — no prorated refunds, no midstream changes. This matches standard SaaS practice and avoids both the revenue hit and the support burden of downgrade refunds.

When a renewal fails, the member enters a three-day grace period. Access is preserved. Reminder emails go out on day one and day three through the email adapter. If Stripe has not resolved the payment by end of grace, access is revoked and the member receives a final email with a link to update their payment method. Reactivation is automatic when Stripe resolves the charge.

## The admin

The admin is a set of authenticated routes within the Worker. It is available only to the single owner, identified by an email address configured at deploy time. The owner logs in the same way members do — magic link.

The admin provides:

- **Plans management.** Create, edit, deactivate plans. Set price, billing interval, and redirect URL per plan. Saving a plan syncs it to Stripe.
- **Access rules management.** Define URL patterns and which plans can access them. See all rules in one view, ordered by specificity.
- **Members list.** Paginated, searchable by email.
- **Member detail.** Per member: plans held, join date, Stripe subscription status, payment history, last seen, recent page visits (last 20), lifetime pageview count.
- **Member actions.** Comp a membership (grant a plan without charge), cancel subscription, issue refund through Stripe, change plan, resend magic link, soft-delete (ban).
- **Email adapter configuration.** Pick the active adapter, paste its credentials, send a test message.

Everything in the admin is server-rendered HTML forms. No SPA. No build step for admin views either.

## Analytics and tracking

Pageview tracking is deliberately minimal. For each authenticated pageview, the Worker updates the member's `last_seen` timestamp and increments their `pageview_count` in D1, and pushes the URL onto a length-20 ring buffer in KV keyed by member ID. That is the entire analytics model.

No per-pageview D1 rows. No session replay. No event pipeline. The owner can see who is active and what they recently visited, which is enough to answer the real questions — "is this member engaged, what are they reading" — without building a data warehouse on Cloudflare's smallest primitives.

If an owner wants deeper analytics, they are free to add their own instrumentation in the pages they author. CFMembership does not try to be a product analytics platform.

## The email adapter contract

Every adapter implements a small interface. The core method sends a transactional email given a recipient, a template identifier, and a variables object. The system ships built-in templates for magic links, welcome, payment receipt, payment-failed reminders, and access-revoked notification. Adapters render these through whatever mechanism the upstream service prefers.

The Kit adapter additionally implements list sync. When a member joins a plan, is removed from a plan, or has their account deleted, the adapter pushes the change to Kit as tag additions or removals. This means the owner's Kit subscriber list stays synchronized with their CFMembership plan roster without the owner writing a single integration.

Cloudflare Email is the default adapter. It uses Cloudflare's new outbound email feature directly from the Worker, which means a functioning CFMembership install with no third-party email dependency is possible. Resend is offered for owners who want more sophisticated deliverability and a fuller sending dashboard. Kit is offered for owners whose email strategy is already in Kit and who want membership to drive segmentation.

Additional adapters — Postmark, Mailgun, SendGrid, Mailchimp, others — are expected to come from the community. The adapter directory is a plugin surface, not a core module.

## Data model (conceptual)

**D1 tables:**

- `members` — id, email, created_at, last_seen_at, pageview_count, status (active, canceled, banned)
- `plans` — id, name, price_cents, interval, redirect_url, stripe_product_id, stripe_price_id, active, sort_order
- `memberships` — member_id, plan_id, stripe_subscription_id, status, current_period_end, canceled_at, source (paid, comped)
- `access_rules` — id, url_pattern, pattern_type (exact, prefix), sort_order
- `access_rule_plans` — rule_id, plan_id (many-to-many)
- `payments` — id, member_id, stripe_charge_id, amount_cents, status, created_at
- `admin_config` — singleton key-value for settings (Stripe key, active email adapter, adapter config, owner email)

**KV namespaces:**

- `SESSIONS` — session_id → member_id, with sliding TTL
- `MAGIC_LINKS` — token → email and intent, short TTL
- `RECENT_PAGES` — member_id → ring buffer of last 20 URLs
- `RATE_LIMITS` — various keys for signup throttling, magic link request throttling

This is small enough that a new contributor can hold the entire schema in their head.

## What is explicitly out of scope

- Multi-tenancy. Each install serves one site.
- Content authoring. CFMembership protects URLs; it does not produce them.
- Rich role-based access control. There is one owner.
- Internal messaging, forums, community features. Those belong in other tools.
- Mobile apps. The site is the product.
- Analytics beyond rollup + recent pages.
- Internationalization of the admin in v1. Member-facing templates are owner-editable, so they can be localized per install; the admin ships in English.
- One-time purchases. CFMembership is recurring-subscription-only in v1. Add-ons, lifetime deals, and pay-what-you-want are future work.
- Team or family plans where one payment covers multiple members. Future work.

## Design principles

*The platform disappears into the stack.* If the owner has to think about CFMembership's internals during normal operation, something is wrong.

*Vanilla everything.* Every non-vanilla dependency adds cognitive weight to every future reader. The Stripe SDK and the Cloudflare runtime are the only dependencies in the reasonable case.

*Stripe is the source of truth for money.* The local mirror exists for display and query convenience. Webhooks reconcile. When in doubt, trust Stripe.

*URLs are the primary interface.* Access control, redirects, paywalls, post-signup landing — all expressed as URLs the owner already owns on their own site.

*The admin is boring.* Server-rendered HTML forms. Tables. Buttons that do one thing. No dashboards that look like a SaaS product. The admin is a tool, not a product.

*Plugins are directories, not frameworks.* Drop a file in `adapters/email/`, export the right shape, register it in config. That is the entire plugin story.

## Success criteria

A site owner should be able to go from `git clone` to a working membership site, with one plan, one Stripe integration, and one protected URL, in under an hour — including the Cloudflare account setup if they do not already have one.

A developer reading the codebase for the first time should be able to locate any feature — how magic links work, how rules match, how Stripe webhooks are processed — in under five minutes.

A community adapter for a new email provider should be writable in a single evening.

The whole system should run for a typical membership site (thousands of members, tens of thousands of pageviews per day) on Cloudflare's free or lowest-paid tiers.

## What v1 ships

- Magic-link authentication
- Plan management with Stripe sync
- Access rules with exact-and-prefix matching
- Paywall-driven signup through Stripe Checkout
- Self-serve upgrade and downgrade
- Three-day grace period on failed renewals
- Members list and member detail views with rollup analytics
- Owner actions: comp, cancel, refund, change plan, resend magic link, soft-delete
- Three email adapters: Cloudflare Email (default), Resend, Kit (with list sync)
- One-command deploy via `wrangler deploy`
- Documented adapter contract for community extensions

Everything else is a future release.
