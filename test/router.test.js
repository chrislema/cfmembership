import { SELF } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { applySchema } from './helpers/db.js';

async function body(res) {
  return (await res.text()).trim();
}

beforeAll(async () => {
  await applySchema();
});

describe('request router', () => {
  it('dispatches /setup to the setup handler', async () => {
    const res = await SELF.fetch('https://example.com/setup');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Set up CFMembership');
  });

  it('does not reserve /setup subpaths — they fall through to the proxy', async () => {
    const res = await SELF.fetch('https://example.com/setup/anything');
    expect(res.status).toBe(503);
  });

  it('dispatches /admin to the admin handler', async () => {
    const res = await SELF.fetch('https://example.com/admin', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup');
  });

  it('dispatches /admin/members to the admin handler', async () => {
    const res = await SELF.fetch('https://example.com/admin/members', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/setup');
  });

  it('dispatches /auth/* to the auth handler', async () => {
    const res = await SELF.fetch('https://example.com/auth/callback');
    expect(res.status).toBe(400);
  });

  it('dispatches /webhooks/* to the webhooks handler', async () => {
    const res = await SELF.fetch('https://example.com/webhooks/stripe', {
      method: 'POST',
    });
    expect(await body(res)).toBe('cfmembership:webhooks');
  });

  it('sends everything else to the proxy handler (503 until origin is set)', async () => {
    for (const path of ['/', '/about', '/blog/post-1', '/members/premium/x']) {
      const res = await SELF.fetch(`https://example.com${path}`, {
        redirect: 'manual',
      });
      expect(res.status).toBe(503);
    }
  });

  it('does not confuse /admin-like paths with /admin', async () => {
    const res = await SELF.fetch('https://example.com/administrative');
    expect(res.status).toBe(503);
  });
});
