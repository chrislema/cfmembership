export async function handleWebhooks(request, env, ctx) {
  return new Response('cfmembership:webhooks', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
