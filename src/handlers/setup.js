import { getConfig, setConfig } from '../config.js';
import { createMagicLink } from '../auth/magic-link.js';
import { sendEmail } from '../email/send.js';
import { escapeHtml, htmlResponse, redirectResponse } from '../util/html.js';

export async function handleSetup(request, env, ctx) {
  const ownerEmail = await getConfig(env.DB, 'owner_email');

  if (request.method === 'GET') {
    if (ownerEmail) return redirectResponse('/admin');
    return htmlResponse(renderForm());
  }

  if (request.method === 'POST') {
    if (ownerEmail) {
      return new Response('Setup has already been completed.', {
        status: 409,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    return handleSubmit(request, env, ctx);
  }

  return new Response('Method not allowed', { status: 405 });
}

async function handleSubmit(request, env, ctx) {
  const form = await request.formData().catch(() => new FormData());
  const values = {
    owner_email: (form.get('owner_email') ?? '').toString().trim().toLowerCase(),
    site_name: (form.get('site_name') ?? '').toString().trim(),
    origin_mode: (form.get('origin_mode') ?? 'external').toString(),
    origin_url: (form.get('origin_url') ?? '').toString().trim(),
  };

  const errors = validate(values);
  if (errors.length) return htmlResponse(renderForm({ errors, values }), 400);

  await env.DB.prepare(
    `INSERT INTO members (email, created_at, status)
     VALUES (?, ?, 'active')
     ON CONFLICT(email) DO NOTHING`
  )
    .bind(values.owner_email, Date.now())
    .run();

  await setConfig(env.DB, 'owner_email', values.owner_email);
  if (values.site_name) {
    await setConfig(env.DB, 'site_name', values.site_name);
  }
  await setConfig(env.DB, 'origin_mode', values.origin_mode);
  if (values.origin_mode === 'external') {
    await setConfig(env.DB, 'origin_url', values.origin_url);
  }

  const result = await createMagicLink(env, values.owner_email, 'admin');
  if (result.sent) {
    const origin = new URL(request.url).origin;
    const link = `${origin}/auth/callback?token=${result.token}`;
    try {
      await sendEmail(env, {
        to: values.owner_email,
        template: 'magic-link',
        variables: {
          link,
          site_name: values.site_name || 'CFMembership',
        },
      });
    } catch (err) {
      console.error('setup magic-link send failed', err);
    }
  }

  return htmlResponse(renderCheckEmail(values.owner_email));
}

function validate(v) {
  const errors = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.owner_email)) {
    errors.push('A valid owner email is required.');
  }
  if (v.origin_mode !== 'external' && v.origin_mode !== 'assets') {
    errors.push('Origin mode must be External or Co-located assets.');
  }
  if (v.origin_mode === 'external' && !v.origin_url) {
    errors.push('An origin URL is required when origin mode is External.');
  }
  return errors;
}

function renderForm({ errors = [], values = {} } = {}) {
  const errorBlock = errors.length
    ? `<ul class="errors">${errors
        .map((e) => `<li>${escapeHtml(e)}</li>`)
        .join('')}</ul>`
    : '';
  const selected = (mode) =>
    values.origin_mode === mode ? ' selected' : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CFMembership setup</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #111; }
    h1 { margin-top: 0; }
    .field { margin-top: 1rem; }
    label { display: block; font-weight: 600; }
    input, select { width: 100%; padding: 0.5rem; font: inherit; box-sizing: border-box; }
    button { margin-top: 1.5rem; padding: 0.6rem 1.2rem; font: inherit; cursor: pointer; }
    .hint { color: #555; font-size: 0.9em; margin-top: 0.25rem; }
    .errors { background: #fee; border: 1px solid #c66; padding: 0.75rem 1rem; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>Set up CFMembership</h1>
  <p>One-time setup. The first visitor to finish this form becomes the site owner.</p>
  ${errorBlock}
  <form method="post" action="/setup">
    <div class="field">
      <label for="owner_email">Owner email</label>
      <input id="owner_email" name="owner_email" type="email" required value="${escapeHtml(values.owner_email)}">
      <div class="hint">The address that can sign in to /admin via magic link.</div>
    </div>
    <div class="field">
      <label for="site_name">Site name</label>
      <input id="site_name" name="site_name" type="text" value="${escapeHtml(values.site_name)}">
    </div>
    <div class="field">
      <label for="origin_mode">Origin mode</label>
      <select id="origin_mode" name="origin_mode">
        <option value="external"${selected('external')}>External origin</option>
        <option value="assets"${selected('assets')}>Co-located assets</option>
      </select>
    </div>
    <div class="field">
      <label for="origin_url">Origin URL</label>
      <input id="origin_url" name="origin_url" type="url" value="${escapeHtml(values.origin_url)}" placeholder="https://my-site.pages.dev">
      <div class="hint">Required when origin mode is External.</div>
    </div>
    <button type="submit">Save and send magic link</button>
  </form>
</body>
</html>`;
}

function renderCheckEmail(email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Check your email</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; max-width: 34rem; margin: 3rem auto; padding: 0 1rem; color: #111; }
    h1 { margin-top: 0; }
    code { background: #f2f2f2; padding: 0 0.25rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Check your email</h1>
  <p>A sign-in link has been sent to <code>${escapeHtml(email)}</code>.</p>
  <p>Click the link to reach <code>/admin</code>. Links expire in 15 minutes.</p>
</body>
</html>`;
}
