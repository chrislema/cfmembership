import { selectRule } from './match.js';
import { loadRules } from './rules.js';
import { readSession } from '../auth/session.js';

export async function decideAccess(request, env, ctx) {
  const url = new URL(request.url);

  const rules = await loadRules(env, ctx);
  const rule = selectRule(rules, url.pathname);
  const session = await readSession(request, env, ctx);
  const memberId = session?.memberId ?? null;

  if (!rule) return { type: 'allow', memberId };

  if (rule.allowed_plan_ids.length === 0) {
    return { type: 'deny', reason: 'rule-has-no-plans' };
  }

  if (session) {
    const memberPlans = await getActivePlanIds(env.DB, session.memberId);
    const hasAccess = rule.allowed_plan_ids.some((id) =>
      memberPlans.includes(id)
    );
    if (hasAccess) {
      return { type: 'allow', memberId: session.memberId, rule };
    }
  }

  const redirectUrl = await getRedirectUrlForPlans(
    env.DB,
    rule.allowed_plan_ids
  );
  if (!redirectUrl) return { type: 'deny', reason: 'no-active-redirect-plan' };
  return {
    type: 'redirect',
    url: redirectUrl,
    memberId,
  };
}

export async function getActivePlanIds(db, memberId) {
  const { results } = await db
    .prepare(
      `SELECT plan_id FROM memberships
        WHERE member_id = ? AND status IN ('active', 'grace')`
    )
    .bind(memberId)
    .all();
  return results.map((r) => r.plan_id);
}

export async function getRedirectUrlForPlans(db, planIds) {
  if (planIds.length === 0) return null;
  const placeholders = planIds.map(() => '?').join(',');
  const row = await db
    .prepare(
      `SELECT redirect_url FROM plans
        WHERE id IN (${placeholders}) AND active = 1
        ORDER BY sort_order ASC, id ASC
        LIMIT 1`
    )
    .bind(...planIds)
    .first();
  return row?.redirect_url ?? null;
}
