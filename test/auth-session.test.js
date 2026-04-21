import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  generateSessionId,
  parseSessionCookie,
  buildSessionCookie,
  buildClearSessionCookie,
  createSession,
  readSession,
  destroySession,
} from '../src/auth/session.js';

describe('generateSessionId', () => {
  it('returns a 32-char hex string', () => {
    expect(generateSessionId()).toMatch(/^[0-9a-f]{32}$/);
  });
  it('returns a different id each call', () => {
    expect(generateSessionId()).not.toBe(generateSessionId());
  });
});

describe('parseSessionCookie', () => {
  it('returns null when no header', () => {
    expect(parseSessionCookie(null)).toBeNull();
  });
  it('returns null when the session cookie is absent', () => {
    expect(parseSessionCookie('foo=bar; baz=qux')).toBeNull();
  });
  it('extracts the session id', () => {
    expect(parseSessionCookie('cfm_session=abc123')).toBe('abc123');
  });
  it('finds the cookie among several', () => {
    expect(parseSessionCookie('foo=bar; cfm_session=abc; baz=qux')).toBe('abc');
  });
  it('tolerates whitespace around entries', () => {
    expect(parseSessionCookie('  cfm_session=abc ;  other=1')).toBe('abc');
  });
  it('returns null when the cookie value is empty', () => {
    expect(parseSessionCookie('cfm_session=')).toBeNull();
  });
});

describe('buildSessionCookie', () => {
  it('sets secure defaults', () => {
    const c = buildSessionCookie('abc');
    expect(c).toContain('cfm_session=abc');
    expect(c).toContain('Path=/');
    expect(c).toContain('HttpOnly');
    expect(c).toContain('Secure');
    expect(c).toContain('SameSite=Lax');
    expect(c).toMatch(/Max-Age=\d+/);
  });
  it('respects an override for Max-Age', () => {
    expect(buildSessionCookie('abc', 60)).toContain('Max-Age=60');
  });
});

describe('buildClearSessionCookie', () => {
  it('sets Max-Age=0 and an empty value', () => {
    const c = buildClearSessionCookie();
    expect(c).toContain('cfm_session=;');
    expect(c).toContain('Max-Age=0');
  });
});

describe('createSession + readSession', () => {
  it('stores and retrieves a session', async () => {
    const { sessionId, cookie } = await createSession(env, 42);
    expect(sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(cookie).toContain(`cfm_session=${sessionId}`);

    const request = new Request('https://example.com/', {
      headers: { cookie: `cfm_session=${sessionId}` },
    });

    expect(await readSession(request, env)).toEqual({
      sessionId,
      memberId: 42,
    });
  });

  it('returns null when the request has no cookie', async () => {
    const request = new Request('https://example.com/');
    expect(await readSession(request, env)).toBeNull();
  });

  it('returns null when the session id does not resolve', async () => {
    const request = new Request('https://example.com/', {
      headers: { cookie: 'cfm_session=does-not-exist' },
    });
    expect(await readSession(request, env)).toBeNull();
  });

  it('destroySession removes the record', async () => {
    const { sessionId } = await createSession(env, 42);
    await destroySession(env, sessionId);
    const request = new Request('https://example.com/', {
      headers: { cookie: `cfm_session=${sessionId}` },
    });
    expect(await readSession(request, env)).toBeNull();
  });
});

describe('sliding TTL', () => {
  it('re-writes the session when last touched beyond the threshold', async () => {
    const sessionId = 'slide-stale';
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await env.SESSIONS.put(
      sessionId,
      JSON.stringify({ member_id: 7, created_at: twoDaysAgo, touched_at: twoDaysAgo })
    );

    const request = new Request('https://example.com/', {
      headers: { cookie: `cfm_session=${sessionId}` },
    });
    await readSession(request, env);

    const updated = await env.SESSIONS.get(sessionId, 'json');
    expect(updated.touched_at).toBeGreaterThan(twoDaysAgo);
  });

  it('does not re-write when last touched is recent', async () => {
    const sessionId = 'slide-fresh';
    const justNow = Date.now() - 1000;
    await env.SESSIONS.put(
      sessionId,
      JSON.stringify({ member_id: 7, created_at: justNow, touched_at: justNow })
    );

    const request = new Request('https://example.com/', {
      headers: { cookie: `cfm_session=${sessionId}` },
    });
    await readSession(request, env);

    const unchanged = await env.SESSIONS.get(sessionId, 'json');
    expect(unchanged.touched_at).toBe(justNow);
  });

  it('uses ctx.waitUntil for the sliding write when provided', async () => {
    const sessionId = 'slide-wait';
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await env.SESSIONS.put(
      sessionId,
      JSON.stringify({ member_id: 7, created_at: twoDaysAgo, touched_at: twoDaysAgo })
    );

    const request = new Request('https://example.com/', {
      headers: { cookie: `cfm_session=${sessionId}` },
    });
    const pending = [];
    await readSession(request, env, { waitUntil: (p) => pending.push(p) });

    expect(pending).toHaveLength(1);
    await Promise.all(pending);
  });
});
