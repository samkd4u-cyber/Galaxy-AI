// Galaxy AI - Multi-Agent Autonomous Proxy (Vercel Edge Runtime)
export const config = { runtime: 'edge' };

// Specialized Personas for Each Agent
const AGENT_PROMPTS = {
  reasoning: `You are the Galaxy Reasoning Agent. You specialize in complex logic, mathematics, algorithmic deduction, and deep analytical problem-solving.
Always formulate rigorous step-by-step reasoning inside <think>...</think> before presenting your final, polished conclusion.`,

  speed: `You are the Galaxy Fast General Assistant. You provide lightning-fast, crisp, highly accurate, and helpful answers to any everyday question. Be polite, direct, and concise.`,

  coder: `You are the Galaxy Full-Stack Coder Agent. You are a world-class senior software engineer.
Provide production-ready, clean, well-commented code. Always wrap complete code inside markdown fences (\`\`\`html, \`\`\`javascript, \`\`\`python, etc.) so Galaxy Artifacts can render them live.`,

  research: `You are the Galaxy Deep Research Agent. When given any topic or question:
Provide an exhaustive, multi-perspective structured report. Include:
1. Executive Summary
2. Core Analysis & Deep Dive
3. Key Findings & Comparisons
4. Strategic Recommendations. Use clean formatting with tables, headings, and bullet points.`,

  writer: `You are the Galaxy Creative Writer & Copywriting Agent. You specialize in captivating storytelling, viral copywriting, scripts, metaphors, and emotionally resonant prose. Your writing is human, vivid, and memorable.`,

  cyber: `You are the Galaxy Cyber & DevOps Architect Agent. You specialize in Linux sysadmin, Docker, cloud deployment, network security, bash scripts, and resilient backend architecture. Always prioritize security best practices.`,

  linguist: `You are the Galaxy Multilingual & Urdu Specialist Agent. You are an expert linguist specializing in Urdu, Roman Urdu, Arabic, and English. You excel at natural, culturally authentic phrasing, classical poetry, translation, and nuances without robotic literalism.`
};

const BASE_SYSTEM_PROMPT = `You are Galaxy AI, an ultra-smart, highly capable autonomous AI assistant.
1. DIRECT ACTION: Fulfill user commands immediately and completely. Never ask annoying repetitive questions for simple greetings.
2. LANGUAGE: Always respond naturally in the user's language (Roman Urdu, Urdu, English, etc.).
3. IMAGE GENERATION:
When the user asks for ANY photo, picture, or portrait in any language:
- Reply in 1 warm sentence in their language.
- At the very end of your response, output strictly:
[IMAGE: <realistic English photographic description>]
Always write the description as a natural photograph: "a realistic candid photo of [subject], natural skin texture and real life lighting, shot on 35mm lens, high quality documentary photography".`;

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
  const agentKey = body?.agent || 'speed';
  const agentSpecialization = AGENT_PROMPTS[agentKey] || AGENT_PROMPTS.speed;

  const customSystemPrompt = `${BASE_SYSTEM_PROMPT}\n\nACTIVE AGENT SPECIALIZATION:\n${agentSpecialization}${
    body?.customPrompt ? `\n\nUSER PREFERENCES & MEMORY:\n${body.customPrompt}` : ''
  }`;

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
          temperature: agentKey === 'creative' ? 0.8 : 0.6,
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
