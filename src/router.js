import { handleSetup } from './handlers/setup.js';
import { handleAdmin } from './handlers/admin.js';
import { handleAuth } from './handlers/auth.js';
import { handleWebhooks } from './handlers/webhooks.js';
import { handleProxy } from './handlers/proxy.js';

export async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/setup') {
    return handleSetup(request, env, ctx);
  }
  if (path === '/admin' || path.startsWith('/admin/')) {
    return handleAdmin(request, env, ctx);
  }
  if (path.startsWith('/auth/')) {
    return handleAuth(request, env, ctx);
  }
  if (path.startsWith('/webhooks/')) {
    return handleWebhooks(request, env, ctx);
  }
  return handleProxy(request, env, ctx);
}
