import { importVerificationKey, generateVerificationSignature } from './auth.js';

export async function onRequestPost({ request, env }) {
  const { token } = await request.json().catch(() => ({}));
  const validTokens = (env.VERIFY_TOKENS || '')
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
  const valid = validTokens.includes(token);
  if (!valid) {
    return new Response(
      JSON.stringify({ valid: false }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }


  // 生成带时间戳的 HMAC 签名 auth_token
  const timestamp = Math.floor(Date.now() / 1000);
  
  if (!env.AUTH_SECRET) {
    console.error("未配置 AUTH_SECRET 环境变量，无法生成认证令牌。");
    return new Response(
        JSON.stringify({ valid: false, error: 'Server configuration error for token generation.' }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    // 使用从 auth.js 导入的函数
    const key = await importVerificationKey(env.AUTH_SECRET, ['sign']);
    const signature = await generateVerificationSignature(key, String(timestamp));
    const auth_token = `${timestamp}.${signature}`;

    return new Response(
      JSON.stringify({ valid: true, auth_token }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    // The imported functions already log errors, but we can add context if needed
    console.error("Error during auth_token generation in verify.js:", e.message);
    return new Response(
      JSON.stringify({ valid: false, error: 'Failed to generate authentication token.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
