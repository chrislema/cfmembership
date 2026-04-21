import { getAdapter } from './registry.js';
import { renderTemplate } from './templates.js';

export async function sendEmail(env, { to, template, variables }) {
  const rendered = renderTemplate(template, variables);
  const adapter = await getAdapter(env);
  return adapter.send({ to, ...rendered });
}
