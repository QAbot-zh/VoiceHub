import { validateAuthToken } from './auth.js';

export async function onRequestPost({ request, env }) {
  // Only allow POST requests
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Expected POST request' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // —— Step 0: 验证 auth_token ——
  // The tts.html client sends the token in the 'X-Auth-Token' header.
  const authTokenString = request.headers.get('X-Auth-Token');

  if (!authTokenString) {
    return new Response(
      JSON.stringify({ error: '未通过口令验证 (Missing X-Auth-Token header)' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const authErrorResponse = await validateAuthToken(authTokenString, env);
  if (authErrorResponse) {
    return authErrorResponse; // Return the error response from the validator
  }

  // —— Step 1: 校验 User-Agent (Consistent with transcribe.js) ——
  const ua = request.headers.get('User-Agent') || '';
  if (!/(Mozilla\/|Chrome\/|Safari\/|Firefox\/)/.test(ua)) {
    return new Response(
      JSON.stringify({ error: 'Reject Request' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // —— Step 2: Parse request body and get OpenAI API Key ——
  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { model, input, voice } = payload;

  if (!model || typeof input === 'undefined' || !voice) { // Check typeof input for empty string case
    return new Response(JSON.stringify({ error: 'Missing model, input, or voice in payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  
  // Validate input length (max 4096 characters for  TTS models)
  if (input.length > 4096) {
      return new Response(JSON.stringify({ error: 'Input text exceeds maximum length of 4096 characters.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
      });
  }

  const apiKeys = (env.TTS_API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  if (apiKeys.length === 0) {
    return new Response(JSON.stringify({ error: 'OpenAI API key not configured on server.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];

  // —— Step 3: Call OpenAI TTS API ——
  const OpenAIApiUrl = env.TTS_ENDPOINT || "https://api.openai.com/v1/audio/speech"; // Default to OpenAI TTS endpoint if not set
  
  try {
    const ttsResponse = await fetch(OpenAIApiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${randomKey}`,
        'Content-Type': 'application/json',
        // 'Accept': 'audio/mpeg', // You can specify if you always want a particular format
      },
      body: JSON.stringify({ model, input, voice }),
    });

    if (!ttsResponse.ok) {
      let errorBodyText = `OpenAI API error: ${ttsResponse.status} ${ttsResponse.statusText}`;
      try {
        const sfError = await ttsResponse.json(); // OpenAI might return JSON error details
        errorBodyText = sfError.error?.message || sfError.error || JSON.stringify(sfError);
      } catch (e) { /* Ignore parsing error, use status text or raw body if needed */ }
      
      console.error("OpenAI API Error:", errorBodyText);
      return new Response(
        JSON.stringify({ error: errorBodyText }),
        { status: ttsResponse.status, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Stream the audio response back to the client
    // Clone headers to make them mutable if needed, and ensure correct Content-Type.
    const responseHeaders = new Headers(ttsResponse.headers);
    const contentType = ttsResponse.headers.get('Content-Type') || 'audio/mpeg'; // Default if not provided
    responseHeaders.set('Content-Type', contentType);
    
    // Add Content-Disposition if you want to suggest a filename when opened directly
    // responseHeaders.set('Content-Disposition', 'inline; filename="speech.mp3"');


    return new Response(ttsResponse.body, {
      status: ttsResponse.status,
      statusText: ttsResponse.statusText,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Error calling OpenAI TTS API:', error.message, error.stack);
    return new Response(
      JSON.stringify({ error: 'Failed to call OpenAI TTS API: ' + error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}