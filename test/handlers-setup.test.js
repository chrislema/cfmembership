import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { applySchema, resetDb } from './helpers/db.js';
import { getConfig, setConfig } from '../src/config.js';
import { devMailbox, resetDevMailbox } from '../src/email/adapters/dev.js';

beforeAll(async () => {
  await applySchema();
});

beforeEach(async () => {
  await resetDb();
  resetDevMailbox();
  const { keys } = await env.MAGIC_LINKS.list();
  for (const k of keys) await env.MAGIC_LINKS.delete(k.name);
});

describe('GET /setup', () => {
  it('renders the setup form when the install is unconfigured', async () => {
    const res = await SELF.fetch('https://site.example/setup');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Set up CFMembership');
    expect(body).toContain('name="owner_email"');
    expect(body).toContain('name="origin_mode"');
    expect(body).toContain('name="origin_url"');
  });

  it('redirects to /admin once owner_email is set', async () => {
    await setConfig(env.DB, 'owner_email', 'owner@example.com');
    const res = await SELF.fetch('https://site.example/setup', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/admin');
  });
});

describe('POST /setup', () => {
  async function submit(body) {
    return SELF.fetch('https://site.example/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  it('persists config, creates the owner member, and sends an admin-intent magic link', async () => {
    const body = new URLSearchParams({
      owner_email: 'OWNER@example.com',
      site_name: 'Acme',
      origin_mode: 'external',
      origin_url: 'https://origin.example',
    }).toString();

    const res = await submit(body);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Check your email');
    expect(html).toContain('owner@example.com');

    expect(await getConfig(env.DB, 'owner_email')).toBe('owner@example.com');
    expect(await getConfig(env.DB, 'site_name')).toBe('Acme');
    expect(await getConfig(env.DB, 'origin_mode')).toBe('external');
    expect(await getConfig(env.DB, 'origin_url')).toBe('https://origin.example');

    const member = await env.DB.prepare(
      'SELECT id, email FROM members WHERE email = ?'
    )
      .bind('owner@example.com')
      .first();
    expect(member).toBeTruthy();

    expect(devMailbox).toHaveLength(1);
    expect(devMailbox[0].to).toBe('owner@example.com');
    expect(devMailbox[0].subject).toContain('Acme');

    const { keys } = await env.MAGIC_LINKS.list();
    expect(keys).toHaveLength(1);
    const record = JSON.parse(await env.MAGIC_LINKS.get(keys[0].name));
    expect(record.intent).toBe('admin');
    expect(devMailbox[0].text).toContain(
      `https://site.example/auth/callback?token=${keys[0].name}`
    );
  });

  it('rejects a second setup attempt once owner_email is set', async () => {
    await setConfig(env.DB, 'owner_email', 'first@example.com');
    const res = await submit(
      'owner_email=second@example.com&origin_mode=external&origin_url=https://x.example'
    );
    expect(res.status).toBe(409);
    expect(await getConfig(env.DB, 'owner_email')).toBe('first@example.com');
  });

  it('returns 400 and re-renders the form when the email is missing', async () => {
    const res = await submit(
      'origin_mode=external&origin_url=https://x.example'
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('owner email');
    expect(html).toContain('name="owner_email"');
  });

  it('returns 400 when origin_mode=external but origin_url is blank', async () => {
    const res = await submit(
      'owner_email=owner@x.co&origin_mode=external'
    );
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('origin URL is required');
  });

  it('accepts origin_mode=assets without an origin URL', async () => {
    const res = await submit('owner_email=owner@x.co&origin_mode=assets');
    expect(res.status).toBe(200);
    expect(await getConfig(env.DB, 'origin_mode')).toBe('assets');
    expect(await getConfig(env.DB, 'origin_url')).toBeNull();
  });

  it('escapes HTML-unsafe values when re-rendering the form on error', async () => {
    const body = new URLSearchParams({
      owner_email: '<script>x</script>',
      origin_mode: 'external',
      origin_url: '',
    }).toString();
    const res = await submit(body);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
