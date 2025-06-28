import { validateAuthToken } from './auth.js';

// A helper function to create a WAV header for raw PCM data
function createWavHeader(dataLength, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);

  const writeString = (offset, string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const pcmDataSize = dataLength;
  const fileSize = pcmDataSize + 36; // 44-byte header - 8 bytes for RIFF chunk

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, fileSize, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
  view.setUint16(20, 1, true);  // Audio format (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  view.setUint32(28, byteRate, true);
  const blockAlign = numChannels * (bitsPerSample / 8);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, pcmDataSize, true);

  return new Uint8Array(buffer);
}

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
  const isGemini = model && model.startsWith('gemini-');

  if (!model || typeof input === 'undefined' || !voice) { // Check typeof input for empty string case
    return new Response(JSON.stringify({ error: 'Missing model, input, or voice in payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate input length (max 4096 characters for  TTS models)
  // if (input.length > 4096) {
  //     return new Response(JSON.stringify({ error: 'Input text exceeds maximum length of 4096 characters.' }), {
  //         status: 400,
  //         headers: { 'Content-Type': 'application/json' }
  //     });
  // }

  if (!isGemini) {
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
  } else {
    // —— Gemini Flash TTS ——

    const apiKeys = (env.GEMINI_API_KEYS || '')
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);

    if (apiKeys.length === 0) {
      return new Response(JSON.stringify({ error: 'Gemini API key not configured on server.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const randomKey = apiKeys[Math.floor(Math.random() * apiKeys.length)];
    try {
      // const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${randomKey}`;
      const gBaseUrl = env.GEMINI_BASEURL || 'https://generativelanguage.googleapis.com';
      const gUrl = `${gBaseUrl}/v1beta/models/${model}:generateContent`;
      const geminiBody = {
        contents: [{
          parts: [{ text: input }]
        }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: voice }
            }
          }
        }
      };

      const geminiResp = await fetch(gUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': randomKey
        },
        body: JSON.stringify(geminiBody)
      });

      if (!geminiResp.ok) {
        const errText = await geminiResp.text();
        return new Response(JSON.stringify({ error: errText }), {
          status: geminiResp.status,
        });
      }

      const { candidates } = await geminiResp.json();
      const inline = candidates?.[0]?.content?.parts?.[0]?.inlineData;
      if (!inline?.data) return new Response(JSON.stringify({ error: 'Gemini response missing audio' }), { status: 502 });

      // 将 Base64 PCM 转成二进制流返回给前端
      const pcmData = Uint8Array.from(atob(inline.data), c => c.charCodeAt(0));
      const wavHeader = createWavHeader(pcmData.length);
      const wavBuffer = new Uint8Array(wavHeader.length + pcmData.length);
      wavBuffer.set(wavHeader, 0);
      wavBuffer.set(pcmData, wavHeader.length);
      return new Response(wavBuffer, {
        headers: { 'Content-Type': 'audio/wav' }
      });
    } catch (err) {
      console.error('Gemini TTS fetch failed:', err);
      return new Response(JSON.stringify({ error: 'Network error: ' + err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}