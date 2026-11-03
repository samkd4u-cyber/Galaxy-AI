// Galaxy AI - streaming chat proxy (Vercel Edge Function)
// Talks to ANY OpenAI-compatible /chat/completions endpoint.
// Configure ONLY with environment variables:
//   API_KEY      (required)  your provider key - never put it in frontend code
//   API_BASE     (optional)  default: Google Gemini OpenAI-compatible endpoint
//   MODEL        (optional)  default: gemini-3.8-flash
//   HOURLY_LIMIT (optional)  max requests per IP per hour, default 40

export const config = { runtime: 'edge' };

const SYSTEM_PROMPT =
  'You are Galaxy AI, a friendly, helpful assistant. Reply in English by default. ' +
  'If the user writes in another language, reply in that language. ' +
  'Be clear and concise, and use code blocks for code.';

const MAX_MESSAGES = 30;          // keep only the last 30 messages
const MAX_TEXT_CHARS = 60000;     // per text part safety cap
const MAX_BODY_BYTES = 6_000_000; // ~6 MB request cap (images are base64)

// ---- Simple in-memory per-IP rate limiter ----
// Note: Edge instances are short-lived and not shared, so this is a
// "best effort" limit that stops casual abuse. See README for details.
const hits = new Map(); // ip -> { count, resetAt }

function checkRate(ip, limit) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  // Clean old entries occasionally so memory stays small
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  let entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + hour };
    hits.set(ip, entry);
  }
  entry.count += 1;
  return {
    ok: entry.count <= limit,
    retryAfter: Math.ceil((entry.resetAt - now) / 1000),
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

// Accept only safe, expected message shapes
function cleanMessages(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content.slice(0, MAX_TEXT_CHARS) });
    } else if (Array.isArray(m.content)) {
      const parts = [];
      for (const p of m.content) {
        if (p && p.type === 'text' && typeof p.text === 'string') {
          parts.push({ type: 'text', text: p.text.slice(0, MAX_TEXT_CHARS) });
        } else if (
          p && p.type === 'image_url' && p.image_url &&
          typeof p.image_url.url === 'string' &&
          p.image_url.url.startsWith('data:image/')
        ) {
          parts.push({ type: 'image_url', image_url: { url: p.image_url.url } });
        }
      }
      if (parts.length) out.push({ role: m.role, content: parts });
    }
  }
  return out.slice(-MAX_MESSAGES);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return json({ error: 'method_not_allowed', message: 'Please use POST.' }, 405, { Allow: 'POST' });
  }

  const API_KEY = process.env.API_KEY;
  const API_BASE = (process.env.API_BASE || 'https://generativelanguage.googleapis.com/v1beta/openai').replace(/\/+$/, '');
  const MODEL = process.env.MODEL || 'gemini-3.8-flash';
  const LIMIT = parseInt(process.env.HOURLY_LIMIT || '40', 10) || 40;

  // 1) Missing key
  if (!API_KEY) {
    return json({
      error: 'missing_api_key',
      message: 'The server has no API_KEY set. Add API_KEY in your Vercel Environment Variables, then redeploy.',
    }, 500);
  }

  // 2) Rate limit per IP
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown').split(',')[0].trim();
  const rate = checkRate(ip, LIMIT);
  if (!rate.ok) {
    return json({
      error: 'rate_limited',
      message: `You have reached the limit of ${LIMIT} messages per hour. Please try again in ${Math.ceil(rate.retryAfter / 60)} minute(s).`,
      retryAfter: rate.retryAfter,
    }, 429, { 'Retry-After': String(rate.retryAfter) });
  }

  // 3) Read and validate the body
  let body;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) {
      return json({ error: 'too_large', message: 'That message is too large. Try a smaller image or file.' }, 413);
    }
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad_request', message: 'The request was not valid JSON.' }, 400);
  }
  const messages = cleanMessages(body && body.messages);
  if (!messages || messages.length === 0) {
    return json({ error: 'bad_request', message: 'Please send a "messages" array with at least one message.' }, 400);
  }

  // 4) Call the provider (streaming)
  let upstream;
  try {
    upstream = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      }),
      signal: req.signal, // stops the provider call when the user presses Stop
    });
  } catch (err) {
    return json({ error: 'provider_unreachable', message: 'Could not reach the AI provider. Please try again in a moment.' }, 502);
  }

  if (!upstream.ok) {
    let detail = '';
    try { detail = (await upstream.text()).slice(0, 400); } catch {}
    let message = 'The AI provider returned an error.';
    if (upstream.status === 401 || upstream.status === 403) message = 'The AI provider rejected the API key. Check API_KEY in your Vercel settings.';
    else if (upstream.status === 404) message = 'The model was not found. Check the MODEL and API_BASE settings.';
    else if (upstream.status === 429) message = 'The AI provider free limit was reached. Please wait a bit and try again.';
    else if (upstream.status >= 500) message = 'The AI provider is having problems. Please try again soon.';
    // Show the provider's own reason (short) so problems are easy to diagnose
    try {
      const parsed = JSON.parse(detail);
      const p = (Array.isArray(parsed) ? parsed[0] : parsed) || {};
      const why = (p.error && p.error.message) || p.message || '';
      if (why) message += ` (Provider says, status ${upstream.status}: ${String(why).replace(/\s+/g, ' ').slice(0, 220)})`;
    } catch {
      if (detail) message += ` (Provider says, status ${upstream.status}: ${detail.replace(/\s+/g, ' ').slice(0, 160)})`;
    }
    return json({ error: 'provider_error', message, status: upstream.status, detail }, upstream.status === 429 ? 429 : 502);
  }

  // 5) Pipe the SSE stream straight back to the browser
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
