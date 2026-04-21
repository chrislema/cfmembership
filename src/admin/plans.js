import { adminLayout } from './layout.js';
import { escapeHtml, htmlResponse, redirectResponse } from '../util/html.js';

export async function handlePlans(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/admin/plans') {
    if (request.method === 'POST') return create(request, env);
    return list(env, url.searchParams.get('saved') === '1');
  }

  const rest = path.slice('/admin/plans/'.length).split('/');
  const id = parseInt(rest[0], 10);
  if (!Number.isFinite(id)) return new Response('Not found', { status: 404 });

  if (rest[1] === 'delete' && request.method === 'POST') {
    await env.DB.prepare('UPDATE plans SET active = 0 WHERE id = ?').bind(id).run();
    return redirectResponse('/admin/plans');
  }

  if (request.method === 'POST') return update(request, env, id);
  return edit(env, id);
}

async function list(env, saved) {
  const { results } = await env.DB
    .prepare(
      `SELECT id, name, price_cents, interval, redirect_url, active, sort_order
         FROM plans ORDER BY sort_order ASC, id ASC`
    )
    .all();
  const rows =
    results
      .map(
        (p) => `
    <tr>
      <td><a href="/admin/plans/${p.id}">${escapeHtml(p.name)}</a></td>
      <td>$${(p.price_cents / 100).toFixed(2)}</td>
      <td>${escapeHtml(p.interval)}</td>
      <td>${escapeHtml(p.redirect_url)}</td>
      <td>${p.active ? 'Active' : 'Inactive'}</td>
      <td>${p.sort_order}</td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="6">No plans yet.</td></tr>';

  const content = `
    <table>
      <thead><tr><th>Name</th><th>Price</th><th>Interval</th><th>Redirect</th><th>Status</th><th>Sort</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h2>Create a plan</h2>
    ${form({ interval: 'month', sort_order: 0 }, [], '/admin/plans')}
  `;
  return htmlResponse(
    adminLayout({
      title: 'Plans',
      content,
      flash: saved ? 'Saved.' : null,
    })
  );
}

async function create(request, env) {
  const { values, errors } = await parse(request);
  if (errors.length) {
    const content = `<h2>Create a plan</h2>${form(values, errors, '/admin/plans')}`;
    return htmlResponse(adminLayout({ title: 'Plans', content }), 400);
  }
  await env.DB
    .prepare(
      `INSERT INTO plans (name, price_cents, interval, redirect_url, active, sort_order)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .bind(
      values.name,
      values.price_cents,
      values.interval,
      values.redirect_url,
      values.sort_order
    )
    .run();
  return redirectResponse('/admin/plans?saved=1');
}

async function edit(env, id) {
  const plan = await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!plan) return new Response('Plan not found', { status: 404 });
  const content = `
    ${form(plan, [], `/admin/plans/${id}`)}
    <h2>Danger zone</h2>
    <form method="post" action="/admin/plans/${id}/delete">
      <button type="submit">Deactivate plan</button>
    </form>
  `;
  return htmlResponse(
    adminLayout({ title: `Edit plan: ${plan.name}`, content })
  );
}

async function update(request, env, id) {
  const { values, errors } = await parse(request);
  if (errors.length) {
    const content = form(values, errors, `/admin/plans/${id}`);
    return htmlResponse(
      adminLayout({ title: 'Edit plan', content }),
      400
    );
  }
  await env.DB
    .prepare(
      `UPDATE plans
          SET name = ?, price_cents = ?, interval = ?, redirect_url = ?, sort_order = ?
        WHERE id = ?`
    )
    .bind(
      values.name,
      values.price_cents,
      values.interval,
      values.redirect_url,
      values.sort_order,
      id
    )
    .run();
  return redirectResponse('/admin/plans?saved=1');
}

async function parse(request) {
  const f = await request.formData().catch(() => new FormData());
  const priceRaw = (f.get('price_cents') ?? '').toString().trim();
  const sortRaw = (f.get('sort_order') ?? '0').toString().trim();
  const values = {
    name: (f.get('name') ?? '').toString().trim(),
    price_cents: priceRaw === '' ? NaN : parseInt(priceRaw, 10),
    interval: (f.get('interval') ?? '').toString(),
    redirect_url: (f.get('redirect_url') ?? '').toString().trim(),
    sort_order: sortRaw === '' ? 0 : parseInt(sortRaw, 10) || 0,
  };
  const errors = [];
  if (!values.name) errors.push('Name is required.');
  if (!Number.isFinite(values.price_cents) || values.price_cents < 0) {
    errors.push('Price (cents) must be a non-negative integer.');
  }
  if (values.interval !== 'month' && values.interval !== 'year') {
    errors.push('Interval must be month or year.');
  }
  if (!values.redirect_url) errors.push('Redirect URL is required.');
  return { values, errors };
}

function form(v, errors, action) {
  const err = errors.length
    ? `<div class="errors"><ul>${errors
        .map((e) => `<li>${escapeHtml(e)}</li>`)
        .join('')}</ul></div>`
    : '';
  return `
    ${err}
    <form method="post" action="${escapeHtml(action)}">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" name="name" type="text" required value="${escapeHtml(v.name)}">
      </div>
      <div class="field">
        <label for="price_cents">Price (cents)</label>
        <input id="price_cents" name="price_cents" type="number" required min="0" value="${escapeHtml(v.price_cents)}">
      </div>
      <div class="field">
        <label for="interval">Interval</label>
        <select id="interval" name="interval">
          <option value="month"${v.interval === 'month' ? ' selected' : ''}>Monthly</option>
          <option value="year"${v.interval === 'year' ? ' selected' : ''}>Yearly</option>
        </select>
      </div>
      <div class="field">
        <label for="redirect_url">Redirect URL (sales page)</label>
        <input id="redirect_url" name="redirect_url" type="text" required value="${escapeHtml(v.redirect_url)}">
      </div>
      <div class="field">
        <label for="sort_order">Sort order</label>
        <input id="sort_order" name="sort_order" type="number" value="${escapeHtml(v.sort_order)}">
      </div>
      <div class="field">
        <button type="submit">Save</button>
      </div>
    </form>
  `;
}
