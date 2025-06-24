// auth.js - Common authentication token validation logic

/**
 * Imports the HMAC signing key from the AUTH_SECRET environment variable.
 * @param {string} secret The secret string to use for the key.
 * @param {import("@cloudflare/workers-types").CryptoKeyUsage[]} usage The intended usage for the key (e.g., ['sign']).
 * @returns {Promise<CryptoKey>} The imported HMAC key.
 * @throws {Error} If AUTH_SECRET is not set or key import fails.
 */
async function importAuthKey(secret, usage = ['sign']) {
  if (!secret) {
    console.error("AUTH_SECRET is not configured in environment.");
    throw new Error("Server authentication configuration error.");
  }
  const encoder = new TextEncoder();
  try {
    return await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      usage
    );
  } catch (e) {
    console.error("Error importing key for HMAC:", e.message);
    throw new Error("Server configuration error during key import.");
  }
}

/**
 * Generates an HMAC signature for the given data.
 * @param {CryptoKey} key The HMAC key.
 * @param {string} data The data to sign.
 * @returns {Promise<string>} The hex-encoded signature.
 */
async function generateSignature(key, data) {
  const encoder = new TextEncoder();
  const sigBuf = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(data)
  );
  return Array.from(new Uint8Array(sigBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validates an auth_token.
 * @param {string | null | undefined} authToken The token string to validate (e.g., "timestamp.signature").
 * @param {object} env The environment variables object, must contain AUTH_SECRET and optionally AUTH_TOKEN_TTL.
 * @returns {Promise<Response | null>} Returns a Response object if validation fails, otherwise null for success.
 */
export async function validateAuthToken(authToken, env) {
  // Note: The calling function should handle the "token completely missing" case
  // if it wants a very specific error message for *how* it was missing (e.g. header vs form).
  // This function will treat a null/empty authToken as invalid.
  if (!authToken) {
    return new Response(
      JSON.stringify({ error: '认证令牌未提供或无效' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const [tsStr, sig] = authToken.split('.');
  if (!tsStr || !sig) {
    return new Response(
      JSON.stringify({ error: '认证令牌格式无效' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const ts = parseInt(tsStr, 10);
  const now = Math.floor(Date.now() / 1000);
  // 过期检查 (TTL 可由环境变量控制，默认一个月)
  const ttl = parseInt(env.AUTH_TOKEN_TTL || String(30 * 24 * 3600), 10);

  if (!ts || isNaN(ts) || now - ts > ttl) {
    return new Response(
      JSON.stringify({ error: '令牌已失效，请重新验证' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 验签
  let key;
  try {
    key = await importAuthKey(env.AUTH_SECRET, ['sign']); // 'sign' is needed to re-generate for comparison
  } catch (e) {
    // Error is already logged by importAuthKey
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  
  const expectedSignature = await generateSignature(key, String(ts));

  if (sig !== expectedSignature) {
    return new Response(
      JSON.stringify({ error: '认证令牌签名无效' }), // Changed from "Invalid auth_token signature"
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return null; // Validation successful
}

export { importAuthKey as importVerificationKey, generateSignature as generateVerificationSignature };