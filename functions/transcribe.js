import { validateAuthToken } from './auth.js';

export async function onRequestPost({ request, env }) {
  // —— Step 0: 验证 auth_token —— 
  // 支持从 custom header 或 formData 里提取
  const formPre = await request.clone().formData().catch(() => null);
  const authHeader = request.headers.get('X-Auth-Token');
  const authTokenString = (formPre && formPre.get('auth_token')) || authHeader;
  if (!authTokenString) {
    return new Response(
      JSON.stringify({ error: '未通过口令验证' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }
  
  const authErrorResponse = await validateAuthToken(authTokenString, env);
  if (authErrorResponse) {
    return authErrorResponse; // Return the error response from the validator
  }

  // —— Step 1: 校验 User-Agent —— 
  const ua = request.headers.get('User-Agent') || '';
  if (!/(Mozilla\/|Chrome\/|Safari\/|Firefox\/)/.test(ua)) {
    return new Response(
      JSON.stringify({ error: 'Reject Request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
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
