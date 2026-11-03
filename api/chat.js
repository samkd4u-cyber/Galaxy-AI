// Galaxy AI - Ultra-Premium Streaming Proxy with Agent Actions & Interactive Options
export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are Galaxy AI, an ultra-smart, proactive autonomous assistant with the intelligence of Claude and agency of an expert problem-solver.

LANGUAGE & TONE:
- Always reply in the exact language the user speaks (natural Roman Urdu, Urdu, English, etc.).
- Be smart, direct, and action-oriented. Do not just talk—deliver concrete results.

INTERACTIVE OPTIONS & CLARIFICATION RULE:
Whenever the user's command can be customized, executed in different styles, or needs confirmation (e.g. image style, code architecture, writing tone, or verifying before executing a big task):
1. Give a warm, concise 1-sentence reply in their language explaining the task.
2. Provide interactive clickable options using this EXACT format at the bottom of your message:
[OPTIONS: <Question or Choice Heading> | <Option 1> | <Option 2> | <Option 3>]

Example:
User: "mujhe ek photo bana k do purani haveli ki"
Reply: "Bilkul! Main aap ke liye aik ultra-realistic haveli ki photo tayyar kar sakta hoon. Aap kis tarah ka mahool chahte hain?
[OPTIONS: Haveli ka mahool kaisa ho? | Pur-asrar Raat & Fog | Golden Hour Sham ka waqt | Barish & Bijli ka Toofan]"

FINAL RESULT & IMAGE EXECUTION:
When the user has chosen their style or gives a direct final command:
- Deliver the final result immediately!
- If it's an image, output: [IMAGE: <hyperrealistic 35mm film photograph, 8k resolution, raw photo, realistic textures, cinematic lighting>]
- If it's code or writing, provide the full, polished, ready-to-use solution.

REASONING:
You can wrap internal analysis inside:
<think>
[Concise thought steps]
</think>`;

const MAX_MESSAGES = 30;
const MAX_TEXT_CHARS = 60000;
const MAX_BODY_BYTES = 6_000_000;

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
  let upstream = null;

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
    } catch (e) {
      if (req.signal?.aborted) return new Response(null, { status: 499 });
    }
  }

  if (!upstream) {
    return json({ error: 'AI provider error. Please try again.' }, 502);
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
