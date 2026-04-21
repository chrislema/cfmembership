import { requireAdmin } from '../admin/auth.js';
import { handleLogin } from '../admin/login.js';
import { renderDashboard } from '../admin/dashboard.js';
import { handleConfig } from '../admin/config.js';
import { handlePlans } from '../admin/plans.js';
import { handleRules } from '../admin/rules.js';
import { handleMembers } from '../admin/members.js';

export async function handleAdmin(request, env, ctx) {
  const path = new URL(request.url).pathname;

  if (path === '/admin/login') {
    return handleLogin(request, env, ctx);
  }

  const auth = await requireAdmin(request, env, ctx);
  if (auth.response) return auth.response;

  if (path === '/admin' || path === '/admin/') {
    return renderDashboard(env, auth.user);
  }

  if (path === '/admin/config') {
    return handleConfig(request, env);
  }

  if (path === '/admin/plans' || path.startsWith('/admin/plans/')) {
    return handlePlans(request, env);
  }

  if (path === '/admin/rules' || path.startsWith('/admin/rules/')) {
    return handleRules(request, env);
  }

  if (path === '/admin/members' || path.startsWith('/admin/members/')) {
    return handleMembers(request, env);
  }

  return new Response('Not found', { status: 404 });
}
