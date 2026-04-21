import { escapeHtml } from '../util/html.js';

export function adminLayout({ title, content, nav = true, flash = null }) {
  const navHtml = nav
    ? `<nav>
      <a href="/admin">Dashboard</a>
      <a href="/admin/plans">Plans</a>
      <a href="/admin/rules">Access rules</a>
      <a href="/admin/members">Members</a>
      <a href="/admin/config">Config</a>
      <form method="post" action="/auth/logout" class="logout"><button>Sign out</button></form>
    </nav>`
    : '';

  const flashHtml = flash
    ? `<div class="flash">${escapeHtml(flash)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)} · Admin · CFMembership</title>
  <style>
    body { font: 16px/1.5 system-ui, sans-serif; margin: 0; color: #111; background: #fafafa; }
    nav { background: #222; color: #eee; padding: 0.75rem 1rem; display: flex; align-items: center; flex-wrap: wrap; gap: 1.25rem; }
    nav a { color: #eee; text-decoration: none; }
    nav a:hover { text-decoration: underline; }
    nav form { margin-left: auto; }
    nav button { background: transparent; border: 0; color: #eee; cursor: pointer; font: inherit; }
    main { max-width: 60rem; margin: 2rem auto; padding: 0 1rem; }
    h1 { margin-top: 0; }
    h2 { margin-top: 2rem; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; background: white; }
    th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee; }
    th { background: #f3f3f3; }
    .field { margin-top: 1rem; }
    label { display: block; font-weight: 600; }
    input[type=text], input[type=email], input[type=url], input[type=number], input[type=search], select, textarea { width: 100%; padding: 0.5rem; font: inherit; box-sizing: border-box; }
    button, input[type=submit] { padding: 0.5rem 1rem; font: inherit; cursor: pointer; }
    .logout button { padding: 0; }
    .errors { background: #fee; border: 1px solid #c66; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .flash { background: #efe; border: 1px solid #6c6; padding: 0.75rem 1rem; border-radius: 4px; margin-bottom: 1rem; }
    .hint { color: #555; font-size: 0.9em; margin-top: 0.25rem; }
    a.button, button.inline { display: inline-block; background: #eee; padding: 0.35rem 0.75rem; border: 1px solid #ccc; text-decoration: none; color: #111; border-radius: 3px; cursor: pointer; font: inherit; }
    .row-actions form { display: inline; margin-right: 0.25rem; }
    code { background: #f2f2f2; padding: 0 0.25rem; border-radius: 3px; }
  </style>
</head>
<body>
  ${navHtml}
  <main>
    <h1>${escapeHtml(title)}</h1>
    ${flashHtml}
    ${content}
  </main>
</body>
</html>`;
}
