export async function onRequestGet({ env }) {
    // 检查 OpenAI TTS API 密钥是否存在且不为空
    const openaiKeys = (env.TTS_API_KEYS || '').split(',').filter(Boolean);
    const isOaiTtsAvailable = openaiKeys.length > 0;

    // 检查 Gemini API 密钥是否存在且不为空
    const geminiKeys = (env.GEMINI_API_KEYS || '').split(',').filter(Boolean);
    const isGeminiTtsAvailable = geminiKeys.length > 0;

    // 准备要返回的配置对象
    const availableModels = {
        openai: isOaiTtsAvailable,
        gemini: isGeminiTtsAvailable,
    };

    // 以 JSON 格式返回配置，绝不返回实际的密钥
    return new Response(JSON.stringify(availableModels), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}