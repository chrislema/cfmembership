import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { applySchema, resetDb } from './helpers/db.js';
import {
  loadRules,
  loadRulesFromDb,
  invalidateRuleCache,
} from '../src/access/rules.js';

const CACHE_KEY = 'rules:v1';

beforeAll(async () => {
  await applySchema();
});

beforeEach(async () => {
  await resetDb();
  await env.RULE_CACHE.delete(CACHE_KEY);
});

async function insertPlan(id, name = 'Plan', redirect = '/join') {
  await env.DB.prepare(
    `INSERT INTO plans (id, name, price_cents, interval, redirect_url, active)
     VALUES (?, ?, 1000, 'month', ?, 1)`
  )
    .bind(id, name, redirect)
    .run();
}

async function insertRule(id, url_pattern, pattern_type, sort_order = 0) {
  await env.DB.prepare(
    `INSERT INTO access_rules (id, url_pattern, pattern_type, sort_order)
     VALUES (?, ?, ?, ?)`
  )
    .bind(id, url_pattern, pattern_type, sort_order)
    .run();
}

async function linkRulePlan(rule_id, plan_id) {
  await env.DB.prepare(
    `INSERT INTO access_rule_plans (rule_id, plan_id) VALUES (?, ?)`
  )
    .bind(rule_id, plan_id)
    .run();
}

describe('loadRulesFromDb', () => {
  it('returns an empty array when no rules exist', async () => {
    expect(await loadRulesFromDb(env.DB)).toEqual([]);
  });

  it('returns a rule with its allowed plan ids', async () => {
    await insertRule(1, '/members', 'prefix');
    await insertPlan(100, 'Premium');
    await insertPlan(101, 'Founder');
    await linkRulePlan(1, 100);
    await linkRulePlan(1, 101);

    const rules = await loadRulesFromDb(env.DB);

    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({
      id: 1,
      url_pattern: '/members',
      pattern_type: 'prefix',
      sort_order: 0,
    });
    expect(rules[0].allowed_plan_ids.sort()).toEqual([100, 101]);
  });

  it('returns a rule with empty allowed_plan_ids when no plans are linked', async () => {
    await insertRule(2, '/orphan', 'exact');
    const rules = await loadRulesFromDb(env.DB);
    expect(rules[0].allowed_plan_ids).toEqual([]);
  });

  it('returns multiple rules', async () => {
    await insertRule(1, '/a', 'exact');
    await insertRule(2, '/b', 'prefix');
    await insertRule(3, '/c/d', 'prefix');
    const rules = await loadRulesFromDb(env.DB);
    expect(rules.map((r) => r.id).sort()).toEqual([1, 2, 3]);
  });
});

describe('loadRules (KV-cached)', () => {
  it('populates the cache on a miss', async () => {
    await insertRule(1, '/a', 'exact');

    const rules = await loadRules(env);
    expect(rules).toHaveLength(1);

    const cached = await env.RULE_CACHE.get(CACHE_KEY, 'json');
    expect(cached).toHaveLength(1);
    expect(cached[0].url_pattern).toBe('/a');
  });

  it('returns the cached snapshot on a hit (does not re-read the DB)', async () => {
    await env.RULE_CACHE.put(
      CACHE_KEY,
      JSON.stringify([
        {
          id: 99,
          url_pattern: '/from-cache',
          pattern_type: 'exact',
          sort_order: 0,
          allowed_plan_ids: [],
        },
      ])
    );

    await insertRule(1, '/from-db', 'exact');

    const rules = await loadRules(env);
    expect(rules).toHaveLength(1);
    expect(rules[0].url_pattern).toBe('/from-cache');
  });

  it('uses ctx.waitUntil for the cache write when ctx is provided', async () => {
    await insertRule(1, '/a', 'exact');

    const pending = [];
    const fakeCtx = { waitUntil: (p) => pending.push(p) };

    await loadRules(env, fakeCtx);

    expect(pending).toHaveLength(1);
    await Promise.all(pending);

    const cached = await env.RULE_CACHE.get(CACHE_KEY, 'json');
    expect(cached).toHaveLength(1);
  });
});

describe('invalidateRuleCache', () => {
  it('deletes the cached snapshot', async () => {
    await env.RULE_CACHE.put(CACHE_KEY, JSON.stringify([{ id: 99 }]));
    await invalidateRuleCache(env);
    expect(await env.RULE_CACHE.get(CACHE_KEY)).toBeNull();
  });
});
