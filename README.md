# CFMembership

A self-hosted, open-source membership platform that runs entirely on Cloudflare. Magic-link auth, Stripe billing, URL-based access control, pluggable email adapters. Vanilla JavaScript, vanilla HTML, vanilla CSS. MIT licensed.

## What you get

- A membership site you own end to end, running on Cloudflare Workers
- A reverse proxy that fronts your existing site — no migration, no content changes, your site keeps working
- Server-side access enforcement that cannot be bypassed by disabling JavaScript or using curl
- Stripe-hosted checkout with recurring subscriptions, upgrades, downgrades, and grace periods
- URL-based access rules that work with any content system that produces URLs
- Passwordless authentication via magic links
- Pluggable email adapters with Cloudflare Email, Resend, and Kit included
- A boring server-rendered admin that does not pretend to be a SaaS product
- One deployment serves one site — no multi-tenancy, no external dependencies beyond Stripe and your chosen email provider

## Who this is for

You already have a website, or know how to build one. You want to put some of it behind a paywall without committing to MemberPress, Kajabi, Circle, Memberstack, or a WordPress plugin stack. You are comfortable deploying to Cloudflare, or willing to learn. You want to own your code, your data, and your customer relationship.

## How it works

CFMembership runs as a reverse proxy on Cloudflare Workers. Your domain points at the Worker, and every request flows through it. For each request, the Worker checks if the URL is protected, checks the visitor's session, and either proxies the request to your origin (for public pages or authorized members) or redirects to a sales page (for visitors without access).

```
┌─────────┐     ┌──────────────────────┐     ┌─────────────┐
│ Visitor │ ──▶ │ CFMembership Worker  │ ──▶ │   Origin    │
└─────────┘     │                      │     │  (your site)│
                │ • match access rule  │     └─────────────┘
                │ • check session      │
                │ • allow / redirect   │
                │ • proxy to origin    │
                └──────────────────────┘
```

It does not care how your content is authored — static HTML, a static site generator, a headless CMS, a markdown repo. It only cares about URLs. Your existing site keeps working exactly as it did; CFMembership sits in front of it and decides what's visible to whom.

Enforcement is server-side. The Worker decides before a single byte of protected content leaves the origin. Disabling JavaScript, viewing source, or using curl cannot bypass a paywall — the content was never sent.

You define access rules in the admin: "the prefix `/members/premium/*` requires the Premium or Founder plan." When a request comes in, the Worker matches the URL against your rules, checks the requester's session, and either proxies the page or redirects to the sales page for the required plan. The most-specific matching rule wins, so you can protect a category prefix and override individual URLs under it.

Prospects convert by hitting a paywall, reading the pitch page you wrote, clicking through to Stripe Checkout, and paying. The Stripe webhook provisions their account. A magic link arrives in their inbox. They click it and they are in.

### Two deployment variants

**Variant A — External origin (default).** Your site lives wherever it lives today — Cloudflare Pages, Netlify, Vercel, a VPS, an S3 bucket — and you point CFMembership at it. The Worker proxies requests to your origin. Use this if you already have a site, or if your content comes from a CMS or static site generator.

**Variant B — Co-located assets.** Drop your built static site into the `public/` directory of the CFMembership repo. `wrangler deploy` ships both the membership logic and the site together, served from Workers Assets. Use this if your content is simple — markdown-in-a-repo or hand-authored HTML — and you want one deployment for everything.

Both variants run the same Worker code. You pick the mode in the admin.

## Stack

- **Cloudflare Workers** — routing, access control, reverse proxy, admin, webhook processing
- **Cloudflare D1** — members, plans, access rules, subscriptions, payment history
- **Cloudflare KV** — sessions, magic link tokens, recent-page ring buffers, rate limits, rule cache
- **Cloudflare Workers Assets** — optional, for co-located static sites (Variant B)
- **Cloudflare Email** — default outbound email (swappable)
- **Stripe** — billing, subscriptions, checkout
- **Vanilla JS, HTML, CSS** — no build step, no framework

## Installation

Requirements: a Cloudflare account, a Stripe account, a domain pointed at Cloudflare, Node.js for Wrangler, and an email provider (or use the built-in Cloudflare Email adapter).

```
git clone https://github.com/YOUR_FORK/cfmembership.git
cd cfmembership
npm install
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` to set your account ID, the domain you're deploying to, and the names of your D1 and KV bindings. Then:

```
npx wrangler d1 create cfmembership
npx wrangler kv:namespace create SESSIONS
npx wrangler kv:namespace create MAGIC_LINKS
npx wrangler kv:namespace create RECENT_PAGES
npx wrangler kv:namespace create RATE_LIMITS
```

Copy the IDs returned by each command into `wrangler.toml`. Run the schema migration:

```
npx wrangler d1 execute cfmembership --file=./schema.sql
```

Set your secrets:

```
npx wrangler secret put OWNER_EMAIL
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

Deploy:

```
npx wrangler deploy
```

Route your domain at the Worker. In the Cloudflare dashboard, under your domain's Workers Routes, add a route like `example.com/*` pointing at the `cfmembership` Worker. This makes every request to your domain flow through CFMembership first.

Point Stripe's webhook endpoint at `https://your-domain/webhooks/stripe`. Visit `https://your-domain/admin`, request a magic link with your owner email, and you're in.

Configure your site in the admin:

- **Variant A (external origin):** Set "Origin mode" to `external` and paste your origin URL (e.g., `https://my-site.pages.dev` or wherever your site actually lives). The Worker will proxy all non-admin, non-webhook, non-auth requests to that origin.
- **Variant B (co-located assets):** Drop your built static site into the `public/` directory, redeploy, and set "Origin mode" to `assets`. The Worker serves files directly from the asset bundle.

Create your first plan, add an access rule, and you have a membership site.

## Access rules

Rules are URL patterns paired with allowed plans.

- **Exact** — matches one URL. `/about-premium` matches only that path.
- **Prefix** — matches the URL and everything under it. `/members/*` matches `/members`, `/members/post-1`, `/members/deep/nested/path`.

When multiple rules match, the most specific one wins: exact beats prefix, longer prefix beats shorter prefix. Unmatched URLs are public.

A rule can allow multiple plans. A member holding any of the allowed plans gets access. Members without access are redirected to the first allowed plan's redirect URL — which you built as a sales page for that plan.

## Email adapters

Three adapters ship in v1:

- **Cloudflare Email** (default) — uses Cloudflare's outbound email feature directly. No third-party dependency.
- **Resend** — drop in your Resend API key for better deliverability and a full sending dashboard.
- **Kit (ConvertKit)** — sends transactional email through Kit and keeps Kit tags in sync with plan membership, so your broadcast segments update automatically when members join, switch, or cancel plans.

Writing a new adapter means implementing one interface in a new file under `adapters/email/` and registering it in configuration. See `docs/adapters.md` for the contract and a reference implementation.

## The admin

Available at `/admin`, authenticated via the same magic-link flow members use, restricted to the email in `OWNER_EMAIL`. The admin is server-rendered HTML forms. It provides:

- Site configuration (origin mode and URL, Stripe keys, owner email)
- Plans management (create, edit, deactivate; syncs to Stripe on save)
- Access rules management
- Members list with search
- Member detail: plans, join date, subscription status, payment history, last seen, last 20 pages visited
- Member actions: comp, cancel, refund, change plan, resend magic link, soft-delete
- Email adapter configuration

## Data and privacy

All member data lives in your Cloudflare account. Stripe holds payment data. Your chosen email provider holds delivery logs. CFMembership does not phone home, does not include analytics on member-facing pages, and does not contact any third party beyond Stripe and your configured email adapter.

## What is not in v1

- Team or family plans — future work
- One-time purchases, lifetime deals, add-ons — future work
- Multi-tenancy — out of scope by design
- Content authoring — CFMembership protects URLs, it does not produce them
- Role-based access — there is one owner
- Rich analytics — rollup stats and recent-page buffer only

## License

MIT. See `LICENSE`.

## Contributing

The project values small, legible, vanilla code. Pull requests that add dependencies should justify the dependency. Pull requests that add build tooling should have a very good reason. New email adapters, new documentation, and bug fixes with tests are always welcome.

## Status

Pre-alpha. The vision document (`vision.md`) describes what the project is aiming to be. Code catches up to vision over time.
