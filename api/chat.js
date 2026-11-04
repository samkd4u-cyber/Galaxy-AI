// Galaxy AI - Full Claude Blueprint Engine (Vercel Edge Runtime)
export const config = { runtime: 'edge' };

const BASE_SYSTEM_PROMPT = `You are Galaxy AI, an ultra-intelligent, precise assistant built to match Claude 3.7 standards.

CORE PRINCIPLES:
1. DIRECT ACTION: Fulfill user commands immediately and completely. Never ask unnecessary questions or pop up options for basic greetings.
2. REASONING: When solving complex, coding, or reasoning problems, formulate clear thoughts inside:
<think>
[Concise, structured analytical steps]
</think>
3. LANGUAGE: Match the user's language naturally (Roman Urdu, Urdu, English, etc.).

CODE & ARTIFACTS:
When writing HTML, CSS, JavaScript, SVG, or complete applications, always output clean markdown code blocks with the language tag (e.g. \`\`\`html ... \`\`\`).

ULTRA-REALISTIC 99.99% IMAGE GENERATION:
When the user asks for ANY photo, picture, or portrait in any language:
- Reply in 1 warm sentence.
- At the very end of your response, output strictly:
[IMAGE: <masterpiece English photographic prompt>]
Include: "award-winning 35mm candid documentary photograph, Hasselblad H6D-100c 85mm f/1.2 lens, ultra-realistic human skin with authentic pores and fine textures, natural cinematic studio lighting, shallow depth of field, 8k resolution, raw photo, film grain, unedited real life photo".`;

const MAX_MESSAGES = 30;
const MAX_TEXT_CHARS = 60000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Please use POST' }, 405);

  const API_KEY = process.env.API_KEY;
  const API_BASE = (process.env.API_BASE || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const DEFAULT_MODEL = process.env.MODEL || 'deepseek/deepseek-r1:free,openrouter/free';

  if (!API_KEY) return json({ error: 'Server API_KEY is missing' }, 500);

  let body;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: 'Invalid JSON request' }, 400);
  }

  const requestedModel = body?.model || DEFAULT_MODEL;
  const customSystemPrompt = body?.customPrompt ? `${BASE_SYSTEM_PROMPT}\n\nUSER CUSTOM INSTRUCTIONS & MEMORY:\n${body.customPrompt}` : BASE_SYSTEM_PROMPT;

  const rawMsgs = Array.isArray(body?.messages) ? body.messages : [];
  if (!rawMsgs.length) return json({ error: 'No messages provided' }, 400);

  const cleanMsgs = rawMsgs.slice(-MAX_MESSAGES).map(m => {
    const rawContent = m.content !== undefined ? m.content : (m.text !== undefined ? m.text : '');
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof rawContent === 'string' ? rawContent.slice(0, MAX_TEXT_CHARS) : JSON.stringify(rawContent)
    };
  });

  const models = requestedModel.split(',').map(m => m.trim()).filter(Boolean);
  let upstream = null, lastError = '';

  for (const model of models) {
    try {
      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
          'HTTP-Referer': 'https://galaxy-ai.vercel.app',
          'X-Title': 'Galaxy AI'
        },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.6,
          messages: [{ role: 'system', content: customSystemPrompt }, ...cleanMsgs]
        }),
        signal: req.signal
      });

      if (res.ok) { upstream = res; break; }
      lastError = await res.text();
    } catch (e) {
      if (req.signal?.aborted) return new Response(null, { status: 499 });
      lastError = e.message;
    }
  }

  if (!upstream) {
    return json({ error: 'AI provider error', detail: lastError }, 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no'
    }
  });
}
