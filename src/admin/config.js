import { adminLayout } from './layout.js';
import { escapeHtml, htmlResponse, redirectResponse } from '../util/html.js';
import { getAllConfig, setConfig } from '../config.js';

const EDITABLE_KEYS = [
  'site_name',
  'origin_mode',
  'origin_url',
  'email_adapter',
  'email_from',
  'resend_api_key',
];

export async function handleConfig(request, env) {
  if (request.method === 'POST') {
    return submit(request, env);
  }
  const url = new URL(request.url);
  const saved = url.searchParams.get('saved') === '1';
  const config = await getAllConfig(env.DB);
  return htmlResponse(
    adminLayout({
      title: 'Site configuration',
      content: renderForm(config),
      flash: saved ? 'Saved.' : null,
    })
  );
}

async function submit(request, env) {
  const form = await request.formData().catch(() => new FormData());
  for (const key of EDITABLE_KEYS) {
    const value = form.get(key);
    if (value == null) continue;
    await setConfig(env.DB, key, value.toString().trim());
  }
  return redirectResponse('/admin/config?saved=1');
}

function renderForm(c) {
  const adapter = c.email_adapter ?? 'dev';
  const mode = c.origin_mode ?? 'external';
  return `
    <form method="post" action="/admin/config">
      <div class="field">
        <label for="site_name">Site name</label>
        <input id="site_name" name="site_name" type="text" value="${escapeHtml(c.site_name)}">
      </div>
      <div class="field">
        <label for="origin_mode">Origin mode</label>
        <select id="origin_mode" name="origin_mode">
          <option value="external"${mode === 'external' ? ' selected' : ''}>External</option>
          <option value="assets"${mode === 'assets' ? ' selected' : ''}>Co-located assets</option>
        </select>
      </div>
      <div class="field">
        <label for="origin_url">Origin URL</label>
        <input id="origin_url" name="origin_url" type="url" value="${escapeHtml(c.origin_url)}">
        <div class="hint">Used when origin mode is External.</div>
      </div>
      <h2>Email</h2>
      <div class="field">
        <label for="email_adapter">Adapter</label>
        <select id="email_adapter" name="email_adapter">
          <option value="dev"${adapter === 'dev' ? ' selected' : ''}>dev (in-memory, no send)</option>
          <option value="resend"${adapter === 'resend' ? ' selected' : ''}>Resend</option>
        </select>
      </div>
      <div class="field">
        <label for="email_from">From address</label>
        <input id="email_from" name="email_from" type="email" value="${escapeHtml(c.email_from)}">
      </div>
      <div class="field">
        <label for="resend_api_key">Resend API key</label>
        <input id="resend_api_key" name="resend_api_key" type="text" value="${escapeHtml(c.resend_api_key)}">
        <div class="hint">Only used when the adapter is Resend.</div>
      </div>
      <div class="field">
        <button type="submit">Save</button>
      </div>
    </form>
  `;
}
