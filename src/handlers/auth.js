import { createMagicLink, consumeMagicLink } from '../auth/magic-link.js';
import {
  createSession,
  destroySession,
  parseSessionCookie,
  buildClearSessionCookie,
} from '../auth/session.js';
import { sendEmail } from '../email/send.js';
import { getConfig } from '../config.js';

export async function handleAuth(request, env, ctx) {
  const url = new URL(request.url);

  if (url.pathname === '/auth/magic-link' && request.method === 'POST') {
    return handleMagicLinkRequest(request, env, ctx);
  }

  if (url.pathname === '/auth/callback' && request.method === 'GET') {
    return handleCallback(request, env, ctx);
  }

  if (url.pathname === '/auth/logout') {
    return handleLogout(request, env, ctx);
  }

  return new Response('Not found', { status: 404 });
}

async function readEmail(request) {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await request.json().catch(() => null);
    return body?.email ?? null;
  }
  const form = await request.formData().catch(() => null);
  const value = form?.get('email');
  return typeof value === 'string' ? value : null;
}

function looksLikeEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function handleMagicLinkRequest(request, env, ctx) {
  const raw = await readEmail(request);
  if (!looksLikeEmail(raw)) {
    return new Response('Invalid email', { status: 400 });
  }
  const email = raw.trim().toLowerCase();

  const result = await createMagicLink(env, email);
  if (result.sent) {
    const origin = new URL(request.url).origin;
    const link = `${origin}/auth/callback?token=${result.token}`;
    const siteName = (await getConfig(env.DB, 'site_name')) ?? 'CFMembership';
    try {
      await sendEmail(env, {
        to: email,
        template: 'magic-link',
        variables: { link, site_name: siteName },
      });
    } catch (err) {
      console.error('magic-link send failed', err);
    }
  }

  return new Response('If that email is registered, check your inbox.', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

async function handleCallback(request, env, ctx) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token) {
    return new Response('Missing token', { status: 400 });
  }

  const record = await consumeMagicLink(env, token);
  if (!record) {
    return new Response(
      'This link is invalid or has expired. Request a new one.',
      {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }
    );
  }

  const { cookie } = await createSession(env, record.member_id);

  const destination = record.intent === 'admin' ? '/admin' : '/';
  return new Response(null, {
    status: 302,
    headers: {
      Location: destination,
      'Set-Cookie': cookie,
    },
  });
}

async function handleLogout(request, env, ctx) {
  const sessionId = parseSessionCookie(request.headers.get('cookie'));
  if (sessionId) {
    await destroySession(env, sessionId);
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': buildClearSessionCookie(),
    },
  });
}
