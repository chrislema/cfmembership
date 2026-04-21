import { SELF, fetchMock, env } from 'cloudflare:test';
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from 'vitest';
import {
  applySchema,
  resetDb,
  insertMember,
  insertPlan,
  insertMembership,
  insertRule,
} from './helpers/db.js';
import { setConfig } from '../src/config.js';
import { createSession } from '../src/auth/session.js';

const RULE_CACHE_KEY = 'rules:v1';
const ORIGIN = 'https://origin.example';

beforeAll(async () => {
  await applySchema();
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

beforeEach(async () => {
  await resetDb();
  await env.RULE_CACHE.delete(RULE_CACHE_KEY);
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

describe('handleProxy', () => {
  it('returns 503 when origin_url is not configured', async () => {
    const res = await SELF.fetch('https://site.example/anything');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('no origin configured');
  });

  it('proxies a public page to the configured origin', async () => {
    await setConfig(env.DB, 'origin_url', ORIGIN);

    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/about', method: 'GET' })
      .reply(200, 'about content');

    const res = await SELF.fetch('https://site.example/about');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('about content');
  });

  it('forwards query strings to the origin', async () => {
    await setConfig(env.DB, 'origin_url', ORIGIN);

    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/search?q=hello', method: 'GET' })
      .reply(200, 'results');

    const res = await SELF.fetch('https://site.example/search?q=hello');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('results');
  });

  it('redirects an anonymous visitor hitting a protected path', async () => {
    await setConfig(env.DB, 'origin_url', ORIGIN);
    await insertPlan(10, { redirect_url: '/pitch', sort_order: 0 });
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });

    const res = await SELF.fetch('https://site.example/members/post-1', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/pitch');
  });

  it('lets a member with a matching plan through to origin', async () => {
    await setConfig(env.DB, 'origin_url', ORIGIN);
    await insertMember(1);
    await insertPlan(10);
    await insertMembership(1, 10);
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const { cookie } = await createSession(env, 1);

    fetchMock
      .get(ORIGIN)
      .intercept({ path: '/members/post-1', method: 'GET' })
      .reply(200, 'member content');

    const res = await SELF.fetch('https://site.example/members/post-1', {
      headers: { cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('member content');
  });

  it('redirects a signed-in member whose plans do not match the rule', async () => {
    await setConfig(env.DB, 'origin_url', ORIGIN);
    await insertMember(1);
    await insertPlan(10, { redirect_url: '/pitch', sort_order: 0 });
    await insertPlan(20);
    await insertMembership(1, 20);
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const { cookie } = await createSession(env, 1);

    const res = await SELF.fetch('https://site.example/members/post-1', {
      headers: { cookie },
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/pitch');
  });

  it('returns 403 when a matching rule has no allowed plans', async () => {
    await setConfig(env.DB, 'origin_url', ORIGIN);
    await insertRule(1, '/members', 'prefix', { plan_ids: [] });

    const res = await SELF.fetch('https://site.example/members/x');
    expect(res.status).toBe(403);
  });

  it('returns 503 when origin_mode=assets but ASSETS is not bound', async () => {
    await setConfig(env.DB, 'origin_mode', 'assets');

    const res = await SELF.fetch('https://site.example/about');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('ASSETS binding');
  });
});
