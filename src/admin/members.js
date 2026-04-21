import { adminLayout } from './layout.js';
import { escapeHtml, htmlResponse, redirectResponse } from '../util/html.js';
import { createMagicLink } from '../auth/magic-link.js';
import { sendEmail } from '../email/send.js';
import { getConfig } from '../config.js';

export async function handleMembers(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/admin/members') {
    return list(env, url.searchParams);
  }

  const rest = path.slice('/admin/members/'.length).split('/');
  const id = parseInt(rest[0], 10);
  if (!Number.isFinite(id)) return new Response('Not found', { status: 404 });

  if (request.method === 'POST' && rest[1] === 'resend-link') {
    return resendLink(request, env, id);
  }
  if (request.method === 'POST' && rest[1] === 'soft-delete') {
    return softDelete(env, id);
  }
  if (request.method === 'POST' && rest[1] === 'comp') {
    return comp(request, env, id);
  }

  return detail(env, id, url.searchParams.get('flash'));
}

async function list(env, params) {
  const q = (params.get('q') ?? '').toString().trim();
  const { results } = q
    ? await env.DB
        .prepare(
          `SELECT id, email, status, created_at FROM members
            WHERE email LIKE ? ORDER BY id DESC LIMIT 100`
        )
        .bind(`%${q}%`)
        .all()
    : await env.DB
        .prepare(
          `SELECT id, email, status, created_at FROM members
            ORDER BY id DESC LIMIT 100`
        )
        .all();

  const rows =
    results
      .map(
        (m) => `
    <tr>
      <td><a href="/admin/members/${m.id}">${escapeHtml(m.email)}</a></td>
      <td>${escapeHtml(m.status)}</td>
      <td>${new Date(m.created_at).toISOString().slice(0, 10)}</td>
    </tr>`
      )
      .join('') ||
    '<tr><td colspan="3">No members match.</td></tr>';

  const content = `
    <form method="get" action="/admin/members">
      <div class="field">
        <label for="q">Search by email</label>
        <input id="q" name="q" type="search" value="${escapeHtml(q)}" placeholder="foo@example.com">
      </div>
    </form>
    <table>
      <thead><tr><th>Email</th><th>Status</th><th>Joined</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  return htmlResponse(adminLayout({ title: 'Members', content }));
}

async function detail(env, id, flashKey) {
  const member = await env.DB
    .prepare('SELECT * FROM members WHERE id = ?')
    .bind(id)
    .first();
  if (!member) return new Response('Member not found', { status: 404 });

  const { results: memberships } = await env.DB
    .prepare(
      `SELECT m.id, m.status, m.source, m.current_period_end, m.canceled_at,
              p.name AS plan_name, p.id AS plan_id
         FROM memberships m JOIN plans p ON p.id = m.plan_id
        WHERE m.member_id = ?
        ORDER BY m.id DESC`
    )
    .bind(id)
    .all();

  const { results: activePlans } = await env.DB
    .prepare(
      `SELECT id, name FROM plans WHERE active = 1
         AND id NOT IN (SELECT plan_id FROM memberships WHERE member_id = ?)
        ORDER BY sort_order ASC, id ASC`
    )
    .bind(id)
    .all();

  const msRows =
    memberships
      .map(
        (m) => `
      <tr>
        <td>${escapeHtml(m.plan_name)}</td>
        <td>${escapeHtml(m.status)}</td>
        <td>${escapeHtml(m.source)}</td>
      </tr>`
      )
      .join('') || '<tr><td colspan="3">No memberships.</td></tr>';

  const compForm = activePlans.length
    ? `
    <form method="post" action="/admin/members/${id}/comp">
      <div class="field">
        <label for="plan_id">Comp a plan (grant without charge)</label>
        <select id="plan_id" name="plan_id">
          ${activePlans.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('')}
        </select>
      </div>
      <div class="field"><button type="submit">Comp plan</button></div>
    </form>`
    : '';

  const flashMessage = {
    'link-sent': 'Magic-link email sent.',
    'comped': 'Plan comped.',
    'deleted': 'Member soft-deleted.',
  }[flashKey];

  const content = `
    <table>
      <tr><th>Email</th><td>${escapeHtml(member.email)}</td></tr>
      <tr><th>Status</th><td>${escapeHtml(member.status)}</td></tr>
      <tr><th>Joined</th><td>${new Date(member.created_at).toISOString()}</td></tr>
      <tr><th>Last seen</th><td>${member.last_seen_at ? new Date(member.last_seen_at).toISOString() : '(never)'}</td></tr>
      <tr><th>Pageviews</th><td>${member.pageview_count}</td></tr>
    </table>
    <h2>Memberships</h2>
    <table>
      <thead><tr><th>Plan</th><th>Status</th><th>Source</th></tr></thead>
      <tbody>${msRows}</tbody>
    </table>
    <h2>Actions</h2>
    <div class="row-actions">
      <form method="post" action="/admin/members/${id}/resend-link">
        <button type="submit">Resend magic link</button>
      </form>
      <form method="post" action="/admin/members/${id}/soft-delete" onsubmit="return confirm('Soft-delete this member?');">
        <button type="submit">Soft-delete</button>
      </form>
    </div>
    ${compForm}
  `;
  return htmlResponse(
    adminLayout({
      title: member.email,
      content,
      flash: flashMessage,
    })
  );
}

async function resendLink(request, env, id) {
  const member = await env.DB
    .prepare('SELECT id, email FROM members WHERE id = ?')
    .bind(id)
    .first();
  if (!member) return new Response('Member not found', { status: 404 });

  const result = await createMagicLink(env, member.email, 'login');
  if (result.sent) {
    const origin = new URL(request.url).origin;
    const link = `${origin}/auth/callback?token=${result.token}`;
    const siteName = (await getConfig(env.DB, 'site_name')) ?? 'CFMembership';
    try {
      await sendEmail(env, {
        to: member.email,
        template: 'magic-link',
        variables: { link, site_name: siteName },
      });
    } catch (err) {
      console.error('admin resend-link failed', err);
    }
  }
  return redirectResponse(`/admin/members/${id}?flash=link-sent`);
}

async function softDelete(env, id) {
  await env.DB
    .prepare(`UPDATE members SET status = 'banned' WHERE id = ?`)
    .bind(id)
    .run();
  return redirectResponse(`/admin/members/${id}?flash=deleted`);
}

async function comp(request, env, id) {
  const form = await request.formData().catch(() => new FormData());
  const planId = parseInt((form.get('plan_id') ?? '').toString(), 10);
  if (!Number.isFinite(planId)) {
    return new Response('Invalid plan', { status: 400 });
  }
  await env.DB
    .prepare(
      `INSERT INTO memberships (member_id, plan_id, status, source)
       VALUES (?, ?, 'active', 'comped')
       ON CONFLICT(member_id, plan_id) DO UPDATE SET status = 'active', source = 'comped'`
    )
    .bind(id, planId)
    .run();
  return redirectResponse(`/admin/members/${id}?flash=comped`);
}
