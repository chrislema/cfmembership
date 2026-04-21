import { getConfig } from '../config.js';
import { createDevAdapter } from './adapters/dev.js';
import { createResendAdapter } from './adapters/resend.js';

export async function getAdapter(env) {
  const mode = (await getConfig(env.DB, 'email_adapter')) ?? 'dev';

  if (mode === 'resend') {
    const apiKey = await getConfig(env.DB, 'resend_api_key');
    const from = await getConfig(env.DB, 'email_from');
    return createResendAdapter({ apiKey, from });
  }

  if (mode === 'dev') {
    return createDevAdapter();
  }

  throw new Error(`Unsupported email adapter: ${mode}`);
}
