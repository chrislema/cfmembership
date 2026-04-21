export async function handleAuth(request, env, ctx) {
  return new Response('cfmembership:auth', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
