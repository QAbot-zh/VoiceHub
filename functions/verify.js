export async function onRequestPost({ request, env }) {
  const { token } = await request.json().catch(() => ({}));
  const validTokens = (env.VERIFY_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  console.log("validTokens:", validTokens)
  return new Response(
    JSON.stringify({ valid: validTokens.includes(token) }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}
