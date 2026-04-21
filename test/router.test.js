import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

async function body(res) {
  return (await res.text()).trim();
}

describe('request router', () => {
  it('dispatches /setup to the setup handler', async () => {
    const res = await SELF.fetch('https://example.com/setup');
    expect(res.status).toBe(200);
    expect(await body(res)).toBe('cfmembership:setup');
  });

  it('dispatches /setup/sub-path to the setup handler', async () => {
    const res = await SELF.fetch('https://example.com/setup/email');
    expect(await body(res)).toBe('cfmembership:setup');
  });

  it('dispatches /admin to the admin handler', async () => {
    const res = await SELF.fetch('https://example.com/admin');
    expect(await body(res)).toBe('cfmembership:admin');
  });

  it('dispatches /admin/members to the admin handler', async () => {
    const res = await SELF.fetch('https://example.com/admin/members');
    expect(await body(res)).toBe('cfmembership:admin');
  });

  it('dispatches /auth/* to the auth handler', async () => {
    const res = await SELF.fetch('https://example.com/auth/magic');
    expect(await body(res)).toBe('cfmembership:auth');
  });

  it('dispatches /webhooks/* to the webhooks handler', async () => {
    const res = await SELF.fetch('https://example.com/webhooks/stripe', {
      method: 'POST',
    });
    expect(await body(res)).toBe('cfmembership:webhooks');
  });

  it('sends everything else to the proxy handler', async () => {
    for (const path of ['/', '/about', '/blog/post-1', '/members/premium/x']) {
      const res = await SELF.fetch(`https://example.com${path}`);
      expect(await body(res)).toBe('cfmembership:proxy');
    }
  });

  it('does not confuse /admin-like paths with /admin', async () => {
    const res = await SELF.fetch('https://example.com/administrative');
    expect(await body(res)).toBe('cfmembership:proxy');
  });
});
