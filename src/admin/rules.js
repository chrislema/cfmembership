import { adminLayout } from './layout.js';
import { escapeHtml, htmlResponse, redirectResponse } from '../util/html.js';
import { invalidateRuleCache } from '../access/rules.js';

export async function handleRules(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/admin/rules') {
    if (request.method === 'POST') return create(request, env);
    return list(env, url.searchParams.get('saved') === '1');
  }

  const rest = path.slice('/admin/rules/'.length).split('/');
  const id = parseInt(rest[0], 10);
  if (!Number.isFinite(id)) return new Response('Not found', { status: 404 });

  if (rest[1] === 'delete' && request.method === 'POST') {
    await env.DB.prepare('DELETE FROM access_rules WHERE id = ?').bind(id).run();
    await invalidateRuleCache(env);
    return redirectResponse('/admin/rules');
  }

  if (request.method === 'POST') return update(request, env, id);
  return edit(env, id);
}

async function list(env, saved) {
  const rows = await env.DB
    .prepare(
      `SELECT r.id, r.url_pattern, r.pattern_type, r.sort_order,
              GROUP_CONCAT(p.name, ', ') AS plan_names
         FROM access_rules r
         LEFT JOIN access_rule_plans rp ON rp.rule_id = r.id
         LEFT JOIN plans p ON p.id = rp.plan_id
        GROUP BY r.id
        ORDER BY r.sort_order ASC, r.id ASC`
    )
    .all();
  const body =
    rows.results
      .map(
        (r) => `
    <tr>
      <td><a href="/admin/rules/${r.id}">${escapeHtml(r.url_pattern)}</a></td>
      <td>${escapeHtml(r.pattern_type)}</td>
      <td>${escapeHtml(r.plan_names ?? '(none)')}</td>
      <td>${r.sort_order}</td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="4">No rules yet.</td></tr>';

  const plans = await activePlans(env);
  const content = `
    <table>
      <thead><tr><th>Pattern</th><th>Type</th><th>Plans</th><th>Sort</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    <h2>Create a rule</h2>
    ${form({ pattern_type: 'prefix', sort_order: 0 }, [], plans, new Set(), '/admin/rules')}
  `;
  return htmlResponse(
    adminLayout({
      title: 'Access rules',
      content,
      flash: saved ? 'Saved.' : null,
    })
  );
}

async function create(request, env) {
  const { values, planIds, errors } = await parse(request);
  if (errors.length) {
    const plans = await activePlans(env);
    const content = `<h2>Create a rule</h2>${form(values, errors, plans, new Set(planIds), '/admin/rules')}`;
    return htmlResponse(adminLayout({ title: 'Access rules', content }), 400);
  }
  const result = await env.DB
    .prepare(
      `INSERT INTO access_rules (url_pattern, pattern_type, sort_order) VALUES (?, ?, ?)`
    )
    .bind(values.url_pattern, values.pattern_type, values.sort_order)
    .run();
  const ruleId = result.meta?.last_row_id;
  for (const pid of planIds) {
    await env.DB
      .prepare(`INSERT INTO access_rule_plans (rule_id, plan_id) VALUES (?, ?)`)
      .bind(ruleId, pid)
      .run();
  }
  await invalidateRuleCache(env);
  return redirectResponse('/admin/rules?saved=1');
}

async function edit(env, id) {
  const rule = await env.DB.prepare('SELECT * FROM access_rules WHERE id = ?').bind(id).first();
  if (!rule) return new Response('Rule not found', { status: 404 });
  const { results: links } = await env.DB
    .prepare('SELECT plan_id FROM access_rule_plans WHERE rule_id = ?')
    .bind(id)
    .all();
  const selected = new Set(links.map((r) => r.plan_id));
  const plans = await activePlans(env);
  const content = `
    ${form(rule, [], plans, selected, `/admin/rules/${id}`)}
    <h2>Danger zone</h2>
    <form method="post" action="/admin/rules/${id}/delete">
      <button type="submit">Delete rule</button>
    </form>
  `;
  return htmlResponse(
    adminLayout({ title: `Edit rule: ${rule.url_pattern}`, content })
  );
}

async function update(request, env, id) {
  const { values, planIds, errors } = await parse(request);
  if (errors.length) {
    const plans = await activePlans(env);
    const content = form(values, errors, plans, new Set(planIds), `/admin/rules/${id}`);
    return htmlResponse(adminLayout({ title: 'Edit rule', content }), 400);
  }
  await env.DB
    .prepare(
      `UPDATE access_rules
          SET url_pattern = ?, pattern_type = ?, sort_order = ?
        WHERE id = ?`
    )
    .bind(values.url_pattern, values.pattern_type, values.sort_order, id)
    .run();
  await env.DB.prepare('DELETE FROM access_rule_plans WHERE rule_id = ?').bind(id).run();
  for (const pid of planIds) {
    await env.DB
      .prepare(`INSERT INTO access_rule_plans (rule_id, plan_id) VALUES (?, ?)`)
      .bind(id, pid)
      .run();
  }
  await invalidateRuleCache(env);
  return redirectResponse('/admin/rules?saved=1');
}

async function parse(request) {
  const f = await request.formData().catch(() => new FormData());
  const sortRaw = (f.get('sort_order') ?? '0').toString().trim();
  const values = {
    url_pattern: (f.get('url_pattern') ?? '').toString().trim(),
    pattern_type: (f.get('pattern_type') ?? 'prefix').toString(),
    sort_order: sortRaw === '' ? 0 : parseInt(sortRaw, 10) || 0,
  };
  const planIds = f
    .getAll('plan_ids')
    .map((v) => parseInt(v.toString(), 10))
    .filter(Number.isFinite);
  const errors = [];
  if (!values.url_pattern) errors.push('URL pattern is required.');
  if (!values.url_pattern.startsWith('/')) {
    errors.push('URL pattern must start with "/".');
  }
  if (values.pattern_type !== 'exact' && values.pattern_type !== 'prefix') {
    errors.push('Pattern type must be exact or prefix.');
  }
  if (planIds.length === 0) {
    errors.push('Select at least one plan that can access this rule.');
  }
  return { values, planIds, errors };
}

async function activePlans(env) {
  const { results } = await env.DB
    .prepare('SELECT id, name FROM plans WHERE active = 1 ORDER BY sort_order ASC, id ASC')
    .all();
  return results;
}

function form(v, errors, plans, selected, action) {
  const err = errors.length
    ? `<div class="errors"><ul>${errors
        .map((e) => `<li>${escapeHtml(e)}</li>`)
        .join('')}</ul></div>`
    : '';
  const planBoxes =
    plans
      .map(
        (p) => `
      <label style="font-weight: normal; display: block;">
        <input type="checkbox" name="plan_ids" value="${p.id}"${selected.has(p.id) ? ' checked' : ''}>
        ${escapeHtml(p.name)}
      </label>`
      )
      .join('') ||
    '<p class="hint">No active plans. Create one first under Plans.</p>';

  return `
    ${err}
    <form method="post" action="${escapeHtml(action)}">
      <div class="field">
        <label for="url_pattern">URL pattern</label>
        <input id="url_pattern" name="url_pattern" type="text" required value="${escapeHtml(v.url_pattern)}" placeholder="/members or /members/*">
      </div>
      <div class="field">
        <label for="pattern_type">Pattern type</label>
        <select id="pattern_type" name="pattern_type">
          <option value="prefix"${v.pattern_type === 'prefix' ? ' selected' : ''}>Prefix</option>
          <option value="exact"${v.pattern_type === 'exact' ? ' selected' : ''}>Exact</option>
        </select>
      </div>
      <div class="field">
        <label>Allowed plans</label>
        ${planBoxes}
      </div>
      <div class="field">
        <label for="sort_order">Sort order (tiebreaker)</label>
        <input id="sort_order" name="sort_order" type="number" value="${escapeHtml(v.sort_order)}">
      </div>
      <div class="field">
        <button type="submit">Save</button>
      </div>
    </form>
  `;
}
