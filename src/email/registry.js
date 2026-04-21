import { getConfig } from '../config.js';
import { createDevAdapter } from './adapters/dev.js';
import { createResendAdapter } from './adapters/resend.js';
import { createCloudflareAdapter } from './adapters/cloudflare.js';
import { createKitAdapter } from './adapters/kit.js';

export async function getAdapter(env) {
  const mode = (await getConfig(env.DB, 'email_adapter')) ?? 'dev';
  const from = await getConfig(env.DB, 'email_from');

  if (mode === 'dev') {
    return createDevAdapter();
  }

  if (mode === 'resend') {
    const apiKey = await getConfig(env.DB, 'resend_api_key');
    return createResendAdapter({ apiKey, from });
  }

  if (mode === 'cloudflare') {
    if (!env.EMAIL) {
      throw new Error('Cloudflare Email adapter requires an EMAIL binding in wrangler.toml');
    }
    return createCloudflareAdapter({ emailBinding: env.EMAIL, from });
  }

  if (mode === 'kit') {
    const apiKey = await getConfig(env.DB, 'kit_api_key');
    return createKitAdapter({ apiKey, from });
  }

  throw new Error(`Unsupported email adapter: ${mode}`);
}
