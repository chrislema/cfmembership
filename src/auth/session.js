const COOKIE_NAME = 'cfm_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const SLIDING_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function generateSessionId() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function parseSessionCookie(cookieHeader) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

export function buildSessionCookie(sessionId, maxAgeSeconds = SESSION_TTL_SECONDS) {
  return `${COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function buildClearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createSession(env, memberId) {
  const sessionId = generateSessionId();
  const now = Date.now();
  const data = { member_id: memberId, created_at: now, touched_at: now };
  await env.SESSIONS.put(sessionId, JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return { sessionId, cookie: buildSessionCookie(sessionId) };
}

export async function readSession(request, env, ctx) {
  const sessionId = parseSessionCookie(request.headers.get('cookie'));
  if (!sessionId) return null;

  const data = await env.SESSIONS.get(sessionId, 'json');
  if (!data) return null;

  const now = Date.now();
  const lastTouched = data.touched_at ?? data.created_at ?? 0;
  if (now - lastTouched > SLIDING_THRESHOLD_MS) {
    const updated = { ...data, touched_at: now };
    const write = env.SESSIONS.put(sessionId, JSON.stringify(updated), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
    if (ctx?.waitUntil) ctx.waitUntil(write);
    else await write;
  }

  return { sessionId, memberId: data.member_id };
}

export async function destroySession(env, sessionId) {
  await env.SESSIONS.delete(sessionId);
}
