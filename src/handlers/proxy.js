import { decideAccess } from '../access/decide.js';
import { getConfig } from '../config.js';
import { trackPageview } from '../tracking/pageview.js';

export async function handleProxy(request, env, ctx) {
  const decision = await decideAccess(request, env, ctx);

  if (decision.type === 'redirect') {
    return new Response(null, {
      status: 302,
      headers: { Location: decision.url },
    });
  }

  if (decision.type === 'deny') {
    return new Response('Forbidden', {
      status: 403,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  if (decision.memberId) {
    const url = new URL(request.url);
    const work = trackPageview(
      env,
      decision.memberId,
      url.pathname + url.search
    );
    if (ctx?.waitUntil) ctx.waitUntil(work);
    else await work;
  }

  return fetchFromOrigin(request, env);
}

async function fetchFromOrigin(request, env) {
  const mode = (await getConfig(env.DB, 'origin_mode')) ?? 'external';

  if (mode === 'assets') {
    if (!env.ASSETS) {
      return unconfigured(
        'Origin mode is "assets" but the ASSETS binding is not enabled in wrangler.toml.'
      );
    }
    return env.ASSETS.fetch(request);
  }

  const originUrl = await getConfig(env.DB, 'origin_url');
  if (!originUrl) {
    return unconfigured(
      'CFMembership has no origin configured yet. Visit /setup or /admin to set one.'
    );
  }

  const incoming = new URL(request.url);
  const origin = new URL(originUrl);
  const outgoing = new URL(incoming.pathname + incoming.search, origin);

  return fetch(new Request(outgoing.toString(), request));
}

function unconfigured(message) {
  return new Response(message, {
    status: 503,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
