import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import {
  applySchema,
  resetDb,
  insertMember,
  insertPlan,
  insertMembership,
  insertRule,
} from './helpers/db.js';
import { setConfig, getConfig } from '../src/config.js';
import { createSession } from '../src/auth/session.js';
import { devMailbox, resetDevMailbox } from '../src/email/adapters/dev.js';

const OWNER_EMAIL = 'owner@example.com';
const OWNER_ID = 1;

async function seedOwner() {
  await insertMember(OWNER_ID, OWNER_EMAIL);
  await setConfig(env.DB, 'owner_email', OWNER_EMAIL);
}

async function ownerCookie() {
  await seedOwner();
  const { cookie } = await createSession(env, OWNER_ID);
  return cookie;
}

async function clearKv(ns) {
  const { keys } = await ns.list();
  for (const k of keys) await ns.delete(k.name);
}

beforeAll(async () => {
  await applySchema();
});

beforeEach(async () => {
  await resetDb();
  resetDevMailbox();
  await clearKv(env.MAGIC_LINKS);
  await clearKv(env.SESSIONS);
  await env.RULE_CACHE.delete('rules:v1');
});

describe('admin auth guard', () => {
  it('redirects to /setup when owner_email is unset', async () => {
    const res = await SELF.fetch('https://site.example/admin', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup');
  });

  it('redirects to /admin/login when there is no session', async () => {
    await seedOwner();
    const res = await SELF.fetch('https://site.example/admin', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/login');
  });

  it('returns 403 when the session belongs to a non-owner', async () => {
    await seedOwner();
    await insertMember(2, 'intruder@example.com');
    const { cookie } = await createSession(env, 2);
    const res = await SELF.fetch('https://site.example/admin', {
      headers: { cookie },
    });
    expect(res.status).toBe(403);
  });

  it('serves the dashboard when the owner is signed in', async () => {
    const cookie = await ownerCookie();
    const res = await SELF.fetch('https://site.example/admin', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Dashboard');
    expect(html).toContain(OWNER_EMAIL);
  });
});

describe('GET /admin/login', () => {
  it('renders the login form regardless of session', async () => {
    await seedOwner();
    const res = await SELF.fetch('https://site.example/admin/login');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Sign in to admin');
    expect(html).toContain('name="email"');
  });
});

describe('POST /admin/login', () => {
  it('sends a magic-link email when the submitted email is the owner', async () => {
    await seedOwner();
    const res = await SELF.fetch('https://site.example/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `email=${encodeURIComponent(OWNER_EMAIL)}`,
    });
    expect(res.status).toBe(200);
    expect(devMailbox).toHaveLength(1);
    expect(devMailbox[0].to).toBe(OWNER_EMAIL);

    const { keys } = await env.MAGIC_LINKS.list();
    const record = JSON.parse(await env.MAGIC_LINKS.get(keys[0].name));
    expect(record.intent).toBe('admin');
  });

  it('does not send email when the submitted email is not the owner', async () => {
    await seedOwner();
    const res = await SELF.fetch('https://site.example/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=someone-else@example.com',
    });
    expect(res.status).toBe(200);
    expect(devMailbox).toHaveLength(0);
  });

  it('rejects a malformed email with 400', async () => {
    const res = await SELF.fetch('https://site.example/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=bogus',
    });
    expect(res.status).toBe(400);
  });
});

describe('/admin/config', () => {
  it('renders the editable config form', async () => {
    const cookie = await ownerCookie();
    await setConfig(env.DB, 'site_name', 'Acme');
    const res = await SELF.fetch('https://site.example/admin/config', {
      headers: { cookie },
    });
    const html = await res.text();
    expect(html).toContain('name="site_name"');
    expect(html).toContain('value="Acme"');
  });

  it('persists the submitted values', async () => {
    const cookie = await ownerCookie();
    const body = new URLSearchParams({
      site_name: 'Acme',
      origin_mode: 'external',
      origin_url: 'https://origin.example',
      email_adapter: 'dev',
      email_from: 'from@acme.test',
      resend_api_key: '',
    }).toString();

    const res = await SELF.fetch('https://site.example/admin/config', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/config?saved=1');
    expect(await getConfig(env.DB, 'site_name')).toBe('Acme');
    expect(await getConfig(env.DB, 'origin_url')).toBe('https://origin.example');
  });
});

describe('/admin/plans', () => {
  it('lists plans and shows the create form', async () => {
    const cookie = await ownerCookie();
    await insertPlan(10, { name: 'Premium', redirect_url: '/join' });
    const res = await SELF.fetch('https://site.example/admin/plans', {
      headers: { cookie },
    });
    const html = await res.text();
    expect(html).toContain('Premium');
    expect(html).toContain('/admin/plans/10');
  });

  it('creates a plan from POST', async () => {
    const cookie = await ownerCookie();
    const body = new URLSearchParams({
      name: 'Premium',
      price_cents: '1000',
      interval: 'month',
      redirect_url: '/join',
      sort_order: '0',
    }).toString();
    const res = await SELF.fetch('https://site.example/admin/plans', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const { results } = await env.DB.prepare('SELECT * FROM plans').all();
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Premium');
  });

  it('rejects an invalid plan with 400', async () => {
    const cookie = await ownerCookie();
    const res = await SELF.fetch('https://site.example/admin/plans', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'name=&price_cents=-1&interval=bad&redirect_url=',
    });
    expect(res.status).toBe(400);
  });

  it('updates an existing plan', async () => {
    const cookie = await ownerCookie();
    await insertPlan(10, { name: 'Old' });
    const body = new URLSearchParams({
      name: 'New',
      price_cents: '2000',
      interval: 'year',
      redirect_url: '/join',
      sort_order: '0',
    }).toString();
    const res = await SELF.fetch('https://site.example/admin/plans/10', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body,
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    const row = await env.DB.prepare('SELECT * FROM plans WHERE id = 10').first();
    expect(row.name).toBe('New');
    expect(row.interval).toBe('year');
  });

  it('deactivates a plan via the delete action', async () => {
    const cookie = await ownerCookie();
    await insertPlan(10);
    const res = await SELF.fetch(
      'https://site.example/admin/plans/10/delete',
      {
        method: 'POST',
        headers: { cookie },
        redirect: 'manual',
      }
    );
    expect(res.status).toBe(302);
    const row = await env.DB.prepare('SELECT active FROM plans WHERE id = 10').first();
    expect(row.active).toBe(0);
  });
});

describe('/admin/rules', () => {
  it('creates a rule with plan links and invalidates the cache', async () => {
    const cookie = await ownerCookie();
    await insertPlan(10);
    // Prime cache
    await env.RULE_CACHE.put('rules:v1', JSON.stringify([{ stale: true }]));

    const body = new URLSearchParams();
    body.append('url_pattern', '/members');
    body.append('pattern_type', 'prefix');
    body.append('sort_order', '0');
    body.append('plan_ids', '10');

    const res = await SELF.fetch('https://site.example/admin/rules', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });
    expect(res.status).toBe(302);

    const { results: rules } = await env.DB.prepare('SELECT * FROM access_rules').all();
    expect(rules).toHaveLength(1);
    expect(rules[0].url_pattern).toBe('/members');

    const { results: links } = await env.DB
      .prepare('SELECT plan_id FROM access_rule_plans WHERE rule_id = ?')
      .bind(rules[0].id)
      .all();
    expect(links.map((r) => r.plan_id)).toEqual([10]);

    expect(await env.RULE_CACHE.get('rules:v1')).toBeNull();
  });

  it('rejects a rule without any selected plan', async () => {
    const cookie = await ownerCookie();
    const body = new URLSearchParams({
      url_pattern: '/members',
      pattern_type: 'prefix',
      sort_order: '0',
    }).toString();
    const res = await SELF.fetch('https://site.example/admin/rules', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('at least one plan');
  });

  it('updates a rule and replaces its plan links', async () => {
    const cookie = await ownerCookie();
    await insertPlan(10);
    await insertPlan(20);
    await insertRule(5, '/members', 'prefix', { plan_ids: [10] });

    const body = new URLSearchParams();
    body.append('url_pattern', '/members');
    body.append('pattern_type', 'prefix');
    body.append('sort_order', '0');
    body.append('plan_ids', '20');

    await SELF.fetch('https://site.example/admin/rules/5', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      redirect: 'manual',
    });

    const { results: links } = await env.DB
      .prepare('SELECT plan_id FROM access_rule_plans WHERE rule_id = 5')
      .all();
    expect(links.map((r) => r.plan_id)).toEqual([20]);
  });

  it('deletes a rule and invalidates the cache', async () => {
    const cookie = await ownerCookie();
    await insertPlan(10);
    await insertRule(5, '/members', 'prefix', { plan_ids: [10] });
    await env.RULE_CACHE.put('rules:v1', JSON.stringify([{ stale: true }]));

    await SELF.fetch('https://site.example/admin/rules/5/delete', {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual',
    });

    const row = await env.DB.prepare('SELECT id FROM access_rules WHERE id = 5').first();
    expect(row).toBeNull();
    expect(await env.RULE_CACHE.get('rules:v1')).toBeNull();
  });
});

describe('/admin/members', () => {
  it('lists members and filters by search query', async () => {
    const cookie = await ownerCookie();
    await insertMember(2, 'alice@example.com');
    await insertMember(3, 'bob@example.com');

    const all = await SELF.fetch('https://site.example/admin/members', {
      headers: { cookie },
    });
    const html = await all.text();
    expect(html).toContain('alice@example.com');
    expect(html).toContain('bob@example.com');

    const filtered = await SELF.fetch(
      'https://site.example/admin/members?q=alice',
      { headers: { cookie } }
    );
    const filteredHtml = await filtered.text();
    expect(filteredHtml).toContain('alice@example.com');
    expect(filteredHtml).not.toContain('bob@example.com');
  });

  it('renders a member detail page with memberships', async () => {
    const cookie = await ownerCookie();
    await insertMember(2, 'alice@example.com');
    await insertPlan(10, { name: 'Premium' });
    await insertMembership(2, 10, 'active');

    const res = await SELF.fetch('https://site.example/admin/members/2', {
      headers: { cookie },
    });
    const html = await res.text();
    expect(html).toContain('alice@example.com');
    expect(html).toContain('Premium');
  });

  it('resends a magic link to the member', async () => {
    const cookie = await ownerCookie();
    await insertMember(2, 'alice@example.com');
    const res = await SELF.fetch(
      'https://site.example/admin/members/2/resend-link',
      {
        method: 'POST',
        headers: { cookie },
        redirect: 'manual',
      }
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin/members/2?flash=link-sent');
    expect(devMailbox).toHaveLength(1);
    expect(devMailbox[0].to).toBe('alice@example.com');
  });

  it('soft-deletes a member', async () => {
    const cookie = await ownerCookie();
    await insertMember(2, 'alice@example.com');
    await SELF.fetch('https://site.example/admin/members/2/soft-delete', {
      method: 'POST',
      headers: { cookie },
      redirect: 'manual',
    });
    const row = await env.DB.prepare('SELECT status FROM members WHERE id = 2').first();
    expect(row.status).toBe('banned');
  });

  it('comps a plan for a member', async () => {
    const cookie = await ownerCookie();
    await insertMember(2, 'alice@example.com');
    await insertPlan(10);

    await SELF.fetch('https://site.example/admin/members/2/comp', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'plan_id=10',
      redirect: 'manual',
    });

    const row = await env.DB
      .prepare('SELECT status, source FROM memberships WHERE member_id = 2 AND plan_id = 10')
      .first();
    expect(row.status).toBe('active');
    expect(row.source).toBe('comped');
  });
});

describe('unknown admin subpath', () => {
  it('returns 404', async () => {
    const cookie = await ownerCookie();
    const res = await SELF.fetch('https://site.example/admin/nonsense', {
      headers: { cookie },
    });
    expect(res.status).toBe(404);
  });
});
