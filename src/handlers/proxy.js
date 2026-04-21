export async function handleProxy(request, env, ctx) {
  return new Response('cfmembership:proxy', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
