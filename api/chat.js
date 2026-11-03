// Galaxy AI - Ultra-Premium Streaming Proxy
export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are Galaxy AI, a brilliant, direct autonomous assistant built with the elegance and precision of Claude.

CORE RULES:
1. DIRECT ACTION: Fulfill the user's exact command immediately. NEVER give annoying multiple-choice options or generic greeting questions.
2. LANGUAGE: Always respond naturally in the user's language (Roman Urdu, Urdu, English, etc.).

IMAGE GENERATION (99.99% REALISTIC HUMAN PHOTOGRAPHY):
When the user asks for ANY photo, picture, or portrait in any language (e.g. "realistic picture banao", "tasveer banao", "photo banao", "generate image"):
- Reply in 1 warm sentence in their language.
- At the very end of your response, output:
[IMAGE: <masterpiece English photographic prompt>]

PROMPT FORMULATION:
Inside [IMAGE: ...], formulate a raw, hyper-detailed photography prompt:
"award-winning 35mm candid documentary photograph, Hasselblad H6D-100c 85mm f/1.2 lens, ultra-realistic human skin with authentic pores and imperfections, natural realistic lighting, shallow depth of field, 8k resolution, raw photo, film grain, unedited real life photo".
Never mention CGI, cartoon, render, or illustration.

CODE:
Format code cleanly inside standard markdown blocks:
\`\`\`language
...
\`\`\``;

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
  const API_BASE = (process.env.API_BASE || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const MODEL = process.env.MODEL || 'openai/gpt-oss-120b,openai/gpt-oss-20b';

  if (!API_KEY) return json({ error: 'Server API_KEY is missing' }, 500);

  let body;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return json({ error: 'Invalid JSON request' }, 400);
  }

  const rawMsgs = Array.isArray(body?.messages) ? body.messages : [];
  if (!rawMsgs.length) return json({ error: 'No messages provided' }, 400);

  const cleanMsgs = rawMsgs.slice(-MAX_MESSAGES).map(m => {
    const rawContent = m.content !== undefined ? m.content : (m.text !== undefined ? m.text : '');
    return {
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof rawContent === 'string' ? rawContent.slice(0, MAX_TEXT_CHARS) : JSON.stringify(rawContent)
    };
  });

  const models = MODEL.split(',').map(m => m.trim()).filter(Boolean);
  let upstream = null, lastError = '';

  for (const model of models) {
    try {
      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model,
          stream: true,
          temperature: 0.7,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...cleanMsgs]
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
    return json({ error: 'Provider Error', detail: lastError }, 502);
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
