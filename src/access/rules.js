const CACHE_KEY = 'rules:v1';
const CACHE_TTL_SECONDS = 60;

export async function loadRulesFromDb(db) {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.url_pattern, r.pattern_type, r.sort_order,
              GROUP_CONCAT(rp.plan_id) AS plan_ids
         FROM access_rules r
         LEFT JOIN access_rule_plans rp ON rp.rule_id = r.id
        GROUP BY r.id`
    )
    .all();

  return results.map((r) => ({
    id: r.id,
    url_pattern: r.url_pattern,
    pattern_type: r.pattern_type,
    sort_order: r.sort_order,
    allowed_plan_ids: r.plan_ids
      ? String(r.plan_ids).split(',').map(Number)
      : [],
  }));
}

export async function loadRules(env, ctx) {
  const cached = await env.RULE_CACHE.get(CACHE_KEY, 'json');
  if (cached) return cached;

  const rules = await loadRulesFromDb(env.DB);

  const write = env.RULE_CACHE.put(CACHE_KEY, JSON.stringify(rules), {
    expirationTtl: CACHE_TTL_SECONDS,
  });
  if (ctx?.waitUntil) ctx.waitUntil(write);
  else await write;

  return rules;
}

export async function invalidateRuleCache(env) {
  await env.RULE_CACHE.delete(CACHE_KEY);
}
