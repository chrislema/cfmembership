import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import {
  applySchema,
  resetDb,
  insertMember,
  insertPlan,
  insertMembership,
  insertRule,
} from './helpers/db.js';
import { createSession } from '../src/auth/session.js';
import {
  decideAccess,
  getActivePlanIds,
  getRedirectUrlForPlans,
} from '../src/access/decide.js';

const RULE_CACHE_KEY = 'rules:v1';

beforeAll(async () => {
  await applySchema();
});

beforeEach(async () => {
  await resetDb();
  await env.RULE_CACHE.delete(RULE_CACHE_KEY);
});

function requestFor(path, { cookie } = {}) {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return new Request(`https://example.com${path}`, { headers });
}

describe('getActivePlanIds', () => {
  it('returns an empty array for an unknown member', async () => {
    expect(await getActivePlanIds(env.DB, 999)).toEqual([]);
  });

  it('returns only active and grace memberships', async () => {
    await insertMember(1);
    await insertPlan(10);
    await insertPlan(11);
    await insertPlan(12);
    await insertMembership(1, 10, 'active');
    await insertMembership(1, 11, 'grace');
    await insertMembership(1, 12, 'canceled');

    const ids = (await getActivePlanIds(env.DB, 1)).sort();
    expect(ids).toEqual([10, 11]);
  });
});

describe('getRedirectUrlForPlans', () => {
  it('returns null for an empty list', async () => {
    expect(await getRedirectUrlForPlans(env.DB, [])).toBeNull();
  });

  it('returns the redirect for the plan with the lowest sort_order', async () => {
    await insertPlan(1, { redirect_url: '/pitch-a', sort_order: 2 });
    await insertPlan(2, { redirect_url: '/pitch-b', sort_order: 0 });
    await insertPlan(3, { redirect_url: '/pitch-c', sort_order: 1 });
    expect(await getRedirectUrlForPlans(env.DB, [1, 2, 3])).toBe('/pitch-b');
  });

  it('skips inactive plans', async () => {
    await insertPlan(1, { redirect_url: '/active', sort_order: 1 });
    await insertPlan(2, { redirect_url: '/inactive', sort_order: 0, active: 0 });
    expect(await getRedirectUrlForPlans(env.DB, [1, 2])).toBe('/active');
  });

  it('returns null when every candidate plan is inactive', async () => {
    await insertPlan(1, { active: 0 });
    await insertPlan(2, { active: 0 });
    expect(await getRedirectUrlForPlans(env.DB, [1, 2])).toBeNull();
  });
});

describe('decideAccess', () => {
  it('allows a request against an unprotected path', async () => {
    expect(await decideAccess(requestFor('/about'), env)).toEqual({
      type: 'allow',
    });
  });

  it('redirects an anonymous visitor hitting a protected path', async () => {
    await insertPlan(10, { redirect_url: '/pitch', sort_order: 0 });
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });

    const decision = await decideAccess(requestFor('/members/post-1'), env);
    expect(decision).toEqual({
      type: 'redirect',
      url: '/pitch',
      memberId: null,
    });
  });

  it('allows a member whose active plan is among allowed', async () => {
    await insertMember(1);
    await insertPlan(10);
    await insertMembership(1, 10, 'active');
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const { cookie } = await createSession(env, 1);

    const decision = await decideAccess(requestFor('/members/post-1', { cookie }), env);
    expect(decision.type).toBe('allow');
    expect(decision.memberId).toBe(1);
    expect(decision.rule.id).toBe(1);
  });

  it('allows a member in grace period', async () => {
    await insertMember(1);
    await insertPlan(10);
    await insertMembership(1, 10, 'grace');
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const { cookie } = await createSession(env, 1);

    const decision = await decideAccess(requestFor('/members/post-1', { cookie }), env);
    expect(decision.type).toBe('allow');
  });

  it('redirects a member whose plans do not overlap with the rule', async () => {
    await insertMember(1);
    await insertPlan(10, { redirect_url: '/pitch', sort_order: 0 });
    await insertPlan(20);
    await insertMembership(1, 20, 'active');
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const { cookie } = await createSession(env, 1);

    const decision = await decideAccess(requestFor('/members/post-1', { cookie }), env);
    expect(decision.type).toBe('redirect');
    expect(decision.url).toBe('/pitch');
    expect(decision.memberId).toBe(1);
  });

  it('redirects a member with canceled access', async () => {
    await insertMember(1);
    await insertPlan(10, { redirect_url: '/pitch' });
    await insertMembership(1, 10, 'canceled');
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const { cookie } = await createSession(env, 1);

    const decision = await decideAccess(requestFor('/members/post-1', { cookie }), env);
    expect(decision.type).toBe('redirect');
    expect(decision.url).toBe('/pitch');
  });

  it('picks the redirect URL from the lowest sort_order plan in the rule', async () => {
    await insertPlan(10, { redirect_url: '/cheapest', sort_order: 0 });
    await insertPlan(20, { redirect_url: '/premium', sort_order: 5 });
    await insertRule(1, '/members', 'prefix', { plan_ids: [10, 20] });

    const decision = await decideAccess(requestFor('/members/post-1'), env);
    expect(decision.url).toBe('/cheapest');
  });

  it('honors rule specificity — exact beats prefix on decision', async () => {
    await insertMember(1);
    await insertPlan(10);
    await insertPlan(20);
    await insertMembership(1, 20, 'active');
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    await insertRule(2, '/members/free', 'exact', { plan_ids: [20] });
    const { cookie } = await createSession(env, 1);

    const decision = await decideAccess(requestFor('/members/free', { cookie }), env);
    expect(decision.type).toBe('allow');
    expect(decision.rule.id).toBe(2);
  });

  it('denies when a matching rule has no allowed plans', async () => {
    await insertRule(1, '/members', 'prefix', { plan_ids: [] });
    const decision = await decideAccess(requestFor('/members/x'), env);
    expect(decision.type).toBe('deny');
    expect(decision.reason).toBe('rule-has-no-plans');
  });

  it('denies when every allowed plan has been deactivated', async () => {
    await insertPlan(10, { active: 0 });
    await insertRule(1, '/members', 'prefix', { plan_ids: [10] });
    const decision = await decideAccess(requestFor('/members/x'), env);
    expect(decision.type).toBe('deny');
    expect(decision.reason).toBe('no-active-redirect-plan');
  });
});
