import { readSession } from '../auth/session.js';
import { getConfig } from '../config.js';
import { redirectResponse } from '../util/html.js';

export async function requireAdmin(request, env, ctx) {
  const ownerEmail = await getConfig(env.DB, 'owner_email');
  if (!ownerEmail) {
    return { response: redirectResponse('/setup') };
  }

  const session = await readSession(request, env, ctx);
  if (!session) {
    return { response: redirectResponse('/admin/login') };
  }

  const member = await env.DB
    .prepare('SELECT id, email FROM members WHERE id = ?')
    .bind(session.memberId)
    .first();

  if (!member || member.email !== ownerEmail) {
    return {
      response: new Response('Forbidden', {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
    };
  }

  return { user: member };
}
