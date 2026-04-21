import { adminLayout } from './layout.js';
import { escapeHtml, htmlResponse } from '../util/html.js';
import { getConfig } from '../config.js';

export async function renderDashboard(env, user) {
  const [members, activePlans, rules, siteName, originMode, originUrl] =
    await Promise.all([
      countRows(env.DB, 'members'),
      env.DB
        .prepare('SELECT COUNT(*) AS n FROM plans WHERE active = 1')
        .first()
        .then((r) => r?.n ?? 0),
      countRows(env.DB, 'access_rules'),
      getConfig(env.DB, 'site_name'),
      getConfig(env.DB, 'origin_mode'),
      getConfig(env.DB, 'origin_url'),
    ]);

  const content = `
    <p>Signed in as <code>${escapeHtml(user.email)}</code>.</p>
    <h2>Site</h2>
    <table>
      <tr><th>Name</th><td>${escapeHtml(siteName ?? '(unset)')}</td></tr>
      <tr><th>Origin mode</th><td>${escapeHtml(originMode ?? '(unset)')}</td></tr>
      <tr><th>Origin URL</th><td>${escapeHtml(originUrl ?? '(unset)')}</td></tr>
    </table>
    <h2>Counts</h2>
    <table>
      <tr><th>Members</th><td>${members}</td></tr>
      <tr><th>Active plans</th><td>${activePlans}</td></tr>
      <tr><th>Access rules</th><td>${rules}</td></tr>
    </table>
  `;

  return htmlResponse(adminLayout({ title: 'Dashboard', content }));
}

async function countRows(db, table) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
  return r?.n ?? 0;
}
