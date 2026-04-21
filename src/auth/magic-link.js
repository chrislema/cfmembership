const TOKEN_TTL_SECONDS = 15 * 60;

export function generateMagicToken() {
  return crypto.randomUUID().replace(/-/g, '');
}

export async function findMemberByEmail(db, email) {
  return db
    .prepare('SELECT id, email FROM members WHERE email = ?')
    .bind(email)
    .first();
}

export async function createMagicLink(env, email, intent = 'login') {
  const member = await findMemberByEmail(env.DB, email);
  if (!member) return { sent: false };

  const token = generateMagicToken();
  await env.MAGIC_LINKS.put(
    token,
    JSON.stringify({
      email: member.email,
      member_id: member.id,
      intent,
      created_at: Date.now(),
    }),
    { expirationTtl: TOKEN_TTL_SECONDS }
  );

  return { sent: true, token, memberId: member.id };
}

export async function consumeMagicLink(env, token) {
  const raw = await env.MAGIC_LINKS.get(token);
  if (!raw) return null;
  await env.MAGIC_LINKS.delete(token);
  return JSON.parse(raw);
}
