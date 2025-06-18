export async function onRequestPost({ request, env }) {
  const apiKeys = (env.SILICONFLOW_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);
  const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
  const form = await request.formData();
  const resp = await fetch(
    'https://api.siliconflow.cn/v1/audio/transcriptions',
    { method: 'POST',
      headers: { 'Authorization': `Bearer ${randomKey}` },
      body: form
    }
  );
  const data = await resp.json();
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' }
  });
}
