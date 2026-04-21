export async function handleSetup(request, env, ctx) {
  return new Response('cfmembership:setup', {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
