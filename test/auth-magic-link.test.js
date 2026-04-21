import { env, SELF } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { applySchema, resetDb, insertMember } from './helpers/db.js';
import {
  generateMagicToken,
  createMagicLink,
  consumeMagicLink,
} from '../src/auth/magic-link.js';
import { parseSessionCookie } from '../src/auth/session.js';

beforeAll(async () => {
  await applySchema();
});

async function clearKv(ns) {
  const { keys } = await ns.list();
  for (const k of keys) await ns.delete(k.name);
}

beforeEach(async () => {
  await resetDb();
  await clearKv(env.MAGIC_LINKS);
  await clearKv(env.SESSIONS);
});

describe('generateMagicToken', () => {
  it('returns a 32-char hex string', () => {
    expect(generateMagicToken()).toMatch(/^[0-9a-f]{32}$/);
  });
  it('returns a different value each call', () => {
    expect(generateMagicToken()).not.toBe(generateMagicToken());
  });
});

describe('createMagicLink', () => {
  it('returns sent=false for an unknown email', async () => {
    const result = await createMagicLink(env, 'ghost@example.com');
    expect(result).toEqual({ sent: false });
    const { keys } = await env.MAGIC_LINKS.list();
    expect(keys).toHaveLength(0);
  });

  it('mints a token for a known email and stores the record', async () => {
    await insertMember(1, 'found@example.com');
    const { sent, token, memberId } = await createMagicLink(
      env,
      'found@example.com'
    );
    expect(sent).toBe(true);
    expect(memberId).toBe(1);
    expect(token).toMatch(/^[0-9a-f]{32}$/);

    const raw = await env.MAGIC_LINKS.get(token);
    expect(JSON.parse(raw)).toMatchObject({
      email: 'found@example.com',
      member_id: 1,
      intent: 'login',
    });
  });

  it('accepts an explicit intent', async () => {
    await insertMember(1, 'owner@example.com');
    const { token } = await createMagicLink(env, 'owner@example.com', 'admin');
    const record = JSON.parse(await env.MAGIC_LINKS.get(token));
    expect(record.intent).toBe('admin');
  });
});

describe('consumeMagicLink', () => {
  it('returns null for an unknown token', async () => {
    expect(await consumeMagicLink(env, 'nope')).toBeNull();
  });

  it('returns the stored record and deletes the token (single-use)', async () => {
    await insertMember(1, 'a@b.co');
    const { token } = await createMagicLink(env, 'a@b.co');

    const first = await consumeMagicLink(env, token);
    expect(first.member_id).toBe(1);

    expect(await consumeMagicLink(env, token)).toBeNull();
  });
});

describe('POST /auth/magic-link', () => {
  it('accepts a form submission and returns 200', async () => {
    await insertMember(1, 'a@b.co');
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a%40b.co',
    });
    expect(res.status).toBe(200);
  });

  it('accepts a JSON body and returns 200', async () => {
    await insertMember(1, 'a@b.co');
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@b.co' }),
    });
    expect(res.status).toBe(200);
  });

  it('normalizes the email to lowercase before lookup', async () => {
    await insertMember(1, 'mixed@case.co');
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'MIXED@case.co' }),
    });
    expect(res.status).toBe(200);
    const { keys } = await env.MAGIC_LINKS.list();
    expect(keys).toHaveLength(1);
  });

  it('does not mint a token for an unknown email (no enumeration)', async () => {
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });
    expect(res.status).toBe(200);
    const { keys } = await env.MAGIC_LINKS.list();
    expect(keys).toHaveLength(0);
  });

  it('rejects a malformed email with 400', async () => {
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a missing email with 400', async () => {
    const res = await SELF.fetch('https://site.example/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-POST with 404', async () => {
    const res = await SELF.fetch('https://site.example/auth/magic-link');
    expect(res.status).toBe(404);
  });
});

describe('GET /auth/callback', () => {
  it('returns 400 for a missing token', async () => {
    const res = await SELF.fetch('https://site.example/auth/callback');
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown token', async () => {
    const res = await SELF.fetch(
      'https://site.example/auth/callback?token=bogus'
    );
    expect(res.status).toBe(400);
  });

  it('exchanges a valid token for a session and redirects home', async () => {
    await insertMember(1, 'a@b.co');
    const { token } = await createMagicLink(env, 'a@b.co');

    const res = await SELF.fetch(
      `https://site.example/auth/callback?token=${token}`,
      { redirect: 'manual' }
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');

    const sessionId = parseSessionCookie(res.headers.get('set-cookie'));
    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);
    const stored = await env.SESSIONS.get(sessionId, 'json');
    expect(stored.member_id).toBe(1);
  });

  it('routes admin-intent callbacks to /admin', async () => {
    await insertMember(1, 'owner@example.com');
    const { token } = await createMagicLink(env, 'owner@example.com', 'admin');

    const res = await SELF.fetch(
      `https://site.example/auth/callback?token=${token}`,
      { redirect: 'manual' }
    );
    expect(res.headers.get('location')).toBe('/admin');
  });

  it('consumes the token so it cannot be used twice', async () => {
    await insertMember(1, 'a@b.co');
    const { token } = await createMagicLink(env, 'a@b.co');

    const res1 = await SELF.fetch(
      `https://site.example/auth/callback?token=${token}`,
      { redirect: 'manual' }
    );
    expect(res1.status).toBe(302);

    const res2 = await SELF.fetch(
      `https://site.example/auth/callback?token=${token}`,
      { redirect: 'manual' }
    );
    expect(res2.status).toBe(400);
  });
});

describe('/auth/logout', () => {
  it('destroys the session and clears the cookie', async () => {
    await env.SESSIONS.put(
      'sess-to-kill',
      JSON.stringify({ member_id: 1, created_at: Date.now() })
    );

    const res = await SELF.fetch('https://site.example/auth/logout', {
      headers: { cookie: 'cfm_session=sess-to-kill' },
      redirect: 'manual',
    });

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    expect(await env.SESSIONS.get('sess-to-kill')).toBeNull();
  });

  it('still returns 302 with a clearing cookie when no session is present', async () => {
    const res = await SELF.fetch('https://site.example/auth/logout', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});

describe('/auth/* unknown paths', () => {
  it('returns 404 for an unknown auth path', async () => {
    const res = await SELF.fetch('https://site.example/auth/nonsense');
    expect(res.status).toBe(404);
  });
});
