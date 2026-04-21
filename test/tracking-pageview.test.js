import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { applySchema, resetDb, insertMember } from './helpers/db.js';
import { trackPageview, getRecentPages } from '../src/tracking/pageview.js';

beforeAll(async () => {
  await applySchema();
});

beforeEach(async () => {
  await resetDb();
  const { keys } = await env.RECENT_PAGES.list();
  for (const k of keys) await env.RECENT_PAGES.delete(k.name);
});

describe('trackPageview', () => {
  it('updates last_seen_at and increments pageview_count', async () => {
    await insertMember(1);
    const before = await env.DB
      .prepare('SELECT pageview_count, last_seen_at FROM members WHERE id = 1')
      .first();
    expect(before.pageview_count).toBe(0);
    expect(before.last_seen_at).toBeNull();

    await trackPageview(env, 1, '/a');
    await trackPageview(env, 1, '/b');

    const after = await env.DB
      .prepare('SELECT pageview_count, last_seen_at FROM members WHERE id = 1')
      .first();
    expect(after.pageview_count).toBe(2);
    expect(after.last_seen_at).toBeGreaterThan(0);
  });

  it('appends to the ring buffer in order', async () => {
    await insertMember(1);
    await trackPageview(env, 1, '/first');
    await trackPageview(env, 1, '/second');
    await trackPageview(env, 1, '/third');

    const ring = await getRecentPages(env, 1);
    expect(ring.map((r) => r.path)).toEqual(['/first', '/second', '/third']);
    for (const r of ring) expect(typeof r.at).toBe('number');
  });

  it('caps the ring buffer at 20 entries', async () => {
    await insertMember(1);
    for (let i = 0; i < 25; i++) {
      await trackPageview(env, 1, `/page-${i}`);
    }
    const ring = await getRecentPages(env, 1);
    expect(ring).toHaveLength(20);
    expect(ring[0].path).toBe('/page-5');
    expect(ring[19].path).toBe('/page-24');
  });

  it('keeps ring buffers separate per member', async () => {
    await insertMember(1);
    await insertMember(2);
    await trackPageview(env, 1, '/a1');
    await trackPageview(env, 2, '/b1');

    expect((await getRecentPages(env, 1)).map((r) => r.path)).toEqual(['/a1']);
    expect((await getRecentPages(env, 2)).map((r) => r.path)).toEqual(['/b1']);
  });
});

describe('getRecentPages', () => {
  it('returns an empty array when no ring has been written', async () => {
    expect(await getRecentPages(env, 99)).toEqual([]);
  });
});
