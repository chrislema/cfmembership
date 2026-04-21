import { magicLinkTemplate } from './templates/magic-link.js';

const templates = {
  'magic-link': magicLinkTemplate,
};

export function renderTemplate(templateId, variables) {
  const t = templates[templateId];
  if (!t) throw new Error(`Unknown email template: ${templateId}`);
  return {
    subject: t.subject(variables),
    text: t.text(variables),
    html: t.html(variables),
  };
}
