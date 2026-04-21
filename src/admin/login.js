import { adminLayout } from './layout.js';
import { escapeHtml, htmlResponse } from '../util/html.js';
import { createMagicLink } from '../auth/magic-link.js';
import { sendEmail } from '../email/send.js';
import { getConfig } from '../config.js';

export async function handleLogin(request, env, ctx) {
  if (request.method === 'GET') {
    return renderForm();
  }
  if (request.method === 'POST') {
    return submit(request, env, ctx);
  }
  return new Response('Method not allowed', { status: 405 });
}

async function submit(request, env, ctx) {
  const form = await request.formData().catch(() => new FormData());
  const email = (form.get('email') ?? '').toString().trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return renderForm({ error: 'Enter a valid email.', email }, 400);
  }

  const ownerEmail = await getConfig(env.DB, 'owner_email');
  if (email === ownerEmail) {
    const result = await createMagicLink(env, email, 'admin');
    if (result.sent) {
      const origin = new URL(request.url).origin;
      const link = `${origin}/auth/callback?token=${result.token}`;
      const siteName = (await getConfig(env.DB, 'site_name')) ?? 'CFMembership';
      try {
        await sendEmail(env, {
          to: email,
          template: 'magic-link',
          variables: { link, site_name: siteName },
        });
      } catch (err) {
        console.error('admin login send failed', err);
      }
    }
  }

  return renderSent(email);
}

function renderForm({ error, email = '' } = {}, status = 200) {
  const errorBlock = error ? `<div class="errors">${escapeHtml(error)}</div>` : '';
  const content = `
    ${errorBlock}
    <p>Enter the owner email. We'll send a sign-in link.</p>
    <form method="post" action="/admin/login">
      <div class="field">
        <label for="email">Owner email</label>
        <input id="email" name="email" type="email" required value="${escapeHtml(email)}">
      </div>
      <button type="submit">Send sign-in link</button>
    </form>
  `;
  return htmlResponse(
    adminLayout({ title: 'Sign in to admin', content, nav: false }),
    status
  );
}

function renderSent(email) {
  const content = `
    <p>If <code>${escapeHtml(email)}</code> is the owner, a sign-in link has been sent.</p>
    <p>Links expire in 15 minutes.</p>
  `;
  return htmlResponse(
    adminLayout({ title: 'Check your email', content, nav: false })
  );
}
