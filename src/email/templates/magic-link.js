export const magicLinkTemplate = {
  subject: (v) => `Your sign-in link for ${v.site_name}`,
  text: (v) =>
    `Sign in to ${v.site_name}:\n\n${v.link}\n\nThis link expires in 15 minutes. If you didn't request it, you can ignore this email.\n`,
  html: (v) =>
    `<p>Sign in to <strong>${escapeHtml(v.site_name)}</strong>:</p>
<p><a href="${escapeHtml(v.link)}">${escapeHtml(v.link)}</a></p>
<p>This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>`,
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
