import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { applySchema, resetDb } from './helpers/db.js';
import { getConfig, setConfig, getAllConfig } from '../src/config.js';

beforeAll(async () => {
  await applySchema();
});

beforeEach(async () => {
  await resetDb();
});

describe('admin_config', () => {
  it('returns null for an unset key', async () => {
    expect(await getConfig(env.DB, 'origin_url')).toBeNull();
  });

  it('stores and retrieves a value', async () => {
    await setConfig(env.DB, 'origin_url', 'https://origin.example');
    expect(await getConfig(env.DB, 'origin_url')).toBe('https://origin.example');
  });

  it('overwrites an existing key via ON CONFLICT', async () => {
    await setConfig(env.DB, 'origin_url', 'a');
    await setConfig(env.DB, 'origin_url', 'b');
    expect(await getConfig(env.DB, 'origin_url')).toBe('b');
  });

  it('getAllConfig returns every row as an object', async () => {
    await setConfig(env.DB, 'origin_url', 'https://origin.example');
    await setConfig(env.DB, 'origin_mode', 'external');
    const all = await getAllConfig(env.DB);
    expect(all).toEqual({
      origin_url: 'https://origin.example',
      origin_mode: 'external',
    });
  });
});
