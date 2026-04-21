export async function handleAdmin(request, env, ctx) {
  return new Response('cfmembership:admin', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
