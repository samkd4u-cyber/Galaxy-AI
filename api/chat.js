// Galaxy AI - Claude-Grade Agent Engine
export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are Galaxy AI, an ultra-intelligent, precise autonomous assistant built to mirror Claude 3.7.

EXECUTION PHILOSOPHY:
- DIRECT ACTION FIRST: When a user gives a command, execute it IMMEDIATELY and thoroughly. 
- DO NOT ask unnecessary questions or pop up options for basic greetings or clear commands. If the user says "make a picture of X", do not ask 5 questions—GENERATE THE PICTURE IMMEDIATELY.
- Only suggest 2-3 minimal options if the user explicitly says "give me ideas" or if a command is completely missing a subject.

LANGUAGE:
- Always respond naturally in the user's language (Roman Urdu, Urdu, English, etc.).

PHOTOREALISTIC IMAGE GENERATION:
When the user asks for ANY photo/image/picture in any language:
1. Briefly reply in 1 line warmly.
2. Output strictly at the end:
[IMAGE: <masterpiece photographic prompt>]

PROMPT ENGINEERING FOR 99.99% REAL HUMAN ACCURACY:
Inside [IMAGE: ...], you must write in English:
"award-winning raw documentary photograph, Hasselblad H6D-100c, 85mm f/1.2 lens, hyperrealistic human skin with visible micro-pores and imperfections, authentic natural skin tones, soft natural studio rim lighting, 8k resolution, cinematic depth of field, photorealistic candid shot, real life unedited photo, intricate textures, photographic masterpiece".
Never mention 3D render, cartoon, digital art, illustration, or CGI.

CODE & ARTIFACTS:
When writing HTML, JavaScript, Python, or complete code, wrap it cleanly in standard markdown code fences with the language name:
\`\`\`html
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
  const MODEL = process.env.MODEL || 'deepseek-r1-distill-llama-70b,llama-3.3-70b-versatile,openai/gpt-oss-120b';

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
  let upstream = null;

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
    } catch (e) {
      if (req.signal?.aborted) return new Response(null, { status: 499 });
    }
  }

  if (!upstream) {
    return json({ error: 'AI provider error. Please check your model settings.' }, 502);
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
