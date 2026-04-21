const RING_SIZE = 20;

function ringKey(memberId) {
  return `member:${memberId}`;
}

export async function trackPageview(env, memberId, path) {
  const now = Date.now();

  await env.DB
    .prepare(
      `UPDATE members
          SET last_seen_at = ?, pageview_count = pageview_count + 1
        WHERE id = ?`
    )
    .bind(now, memberId)
    .run();

  const key = ringKey(memberId);
  const current = (await env.RECENT_PAGES.get(key, 'json')) ?? [];
  const updated = [...current, { path, at: now }].slice(-RING_SIZE);
  await env.RECENT_PAGES.put(key, JSON.stringify(updated));
}

export async function getRecentPages(env, memberId) {
  return (await env.RECENT_PAGES.get(ringKey(memberId), 'json')) ?? [];
}
