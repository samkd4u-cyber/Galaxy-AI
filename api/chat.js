// Galaxy AI - Ultra-Premium Streaming Proxy (Vercel Edge Runtime)
// Supports Thinking reasoning, multilingual image generation & fast fallbacks

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are Galaxy AI, an ultra-intelligent, sophisticated AI assistant built with the elegance, clarity, and precision of Claude.

TONE & STYLE:
- Match the user's language immediately (if Urdu/Roman Urdu, reply warmly in natural Roman Urdu; if English, reply in pristine English).
- Be thoughtful, precise, articulate, and structured. Use clean markdown formatting (headings, bullet points, clean code blocks).

THINKING REASONING INSTRUCTION:
Before answering complex, technical, or analytical questions, provide a brief, high-level reasoning process wrapped strictly inside:
<think>
[Your concise, fast analytical thought steps here]
</think>
Followed immediately by your final, polished response. Keep your thoughts fast and concise.

PHOTOREALISTIC IMAGE GENERATION RULES:
Whenever the user asks to draw, paint, create, generate, or show any image or picture in ANY language (e.g. "tasveer banao", "photo dikhao", "draw an image", "create wallpaper"):
1. Reply conversationally to the user in their language (e.g.: "Yeh lijiye! Main ne aap ke liye aik ultra-realistic photo tayyar kar di hai.").
2. At the very end of your response, output this exact tag:
[IMAGE: <highly detailed English photorealistic prompt>]

PROMPT FORMULATION:
Inside [IMAGE: ...], formulate a masterpiece photography prompt. To ensure it looks like a 100% REAL human/scene and NOT an AI generation, ALWAYS include:
"hyperrealistic candid 35mm photograph, authentic skin pores and natural textures, cinematic lighting, shot on Sony A7R IV 85mm f/1.4, raw photography, depth of field, 8k resolution, authentic real life documentary photo".`;

const MAX_MESSAGES = 30;
const MAX_TEXT_CHARS = 60000;
const MAX_BODY_BYTES = 6_000_000;

const hits = new Map();
function checkRate(ip, limit) {
  const now = Date.now();
  const hour = 3600000;
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  let entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + hour };
    hits.set(ip, entry);
  }
  entry.count += 1;
  return { ok: entry.count <= limit, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
}

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
  const LIMIT = parseInt(process.env.HOURLY_LIMIT || '60', 10);

  if (!API_KEY) return json({ error: 'Server API_KEY is missing' }, 500);

  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const rate = checkRate(ip, LIMIT);
  if (!rate.ok) return json({ error: 'Hourly limit reached. Please wait a bit.' }, 429);

  let body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: 'Message payload too large' }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'Invalid JSON request' }, 400);
  }

  const rawMsgs = Array.isArray(body?.messages) ? body.messages : [];
  if (!rawMsgs.length) return json({ error: 'No messages provided' }, 400);

  const cleanMsgs = rawMsgs.slice(-MAX_MESSAGES).map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: typeof m.content === 'string' ? m.content.slice(0, MAX_TEXT_CHARS) : String(m.content || '')
  }));

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
          temperature: 0.6,
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
    return json({ error: 'AI provider error. Please try again.', detail: lastError }, 502);
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
