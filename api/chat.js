// Galaxy AI - /api/chat  (Vercel Node function)
//
// What it does
//  - Streams the reply (no more 25s timeouts)
//  - Tries several providers/models in order and skips any that fail or are slow
//  - Optional web search (Tavily) so the model can answer with fresh info + sources
//
// Environment variables (Vercel > Settings > Environment Variables). Set any that you have:
//  1. API_BASE + API_KEY (+ MODEL)   your existing OpenAI-compatible provider (tried first)
//  2. GROQ_API_KEY                   console.groq.com        (free)
//  3. GEMINI_API_KEY                 aistudio.google.com     (free)
//  4. OPENROUTER_API_KEY             openrouter.ai           (free :free models)
//  5. TAVILY_API_KEY                 tavily.com              (free, 1000 searches/month) -> enables Web search
// Optional: GROQ_MODELS, GEMINI_MODELS, OPENROUTER_MODELS (comma separated) to override model names.

const FIRST_TOKEN_TIMEOUT_MS = 12000;

const list = (name, fallback) =>
  process.env[name] ? process.env[name].split(",").map((s) => s.trim()).filter(Boolean) : fallback;

const today = () => new Date().toISOString().slice(0, 10);

function systemPrompt() {
  return (
    "You are Galaxy AI, a helpful assistant. Today's date is " + today() + ". " +
    "Reply in the same language the user writes in (including Roman Urdu / Hinglish). " +
    "Be clear and concise. Put code inside markdown code blocks. " +
    "If you are not sure about something, say so instead of guessing."
  );
}

function chatUrl(base) {
  const b = base.trim().replace(/\/+$/, "");
  return /\/chat\/completions$/.test(b) ? b : b + "/chat/completions";
}

// ---------- OpenRouter: free model ids change often, so discover them live ----------
let orCache = { t: 0, models: [] };
async function discoverOpenRouterFree() {
  if (Date.now() - orCache.t < 3600e3) return orCache.models;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch("https://openrouter.ai/api/v1/models", { signal: ctrl.signal });
    clearTimeout(timer);
    const j = await r.json();
    const ids = (j.data || [])
      .filter((m) => typeof m.id === "string" && m.id.endsWith(":free"))
      .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
      .slice(0, 4)
      .map((m) => m.id);
    orCache = { t: Date.now(), models: ids };
  } catch (_) {
    orCache = { t: Date.now() - 3300e3, models: orCache.models }; // retry in ~5 min
  }
  return orCache.models;
}

function configuredProviders() {
  const out = [];
  if (process.env.API_BASE && process.env.API_KEY) {
    out.push({
      id: "custom",
      key: process.env.API_KEY,
      url: chatUrl(process.env.API_BASE),
      models: list("MODEL", ["default"]),
    });
  }
  if (process.env.GROQ_API_KEY) {
    out.push({
      id: "groq",
      key: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      models: list("GROQ_MODELS", ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile", "llama-3.1-8b-instant"]),
    });
  }
  if (process.env.GEMINI_API_KEY) {
    out.push({
      id: "gemini",
      key: process.env.GEMINI_API_KEY,
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      models: list("GEMINI_MODELS", ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3-flash-preview"]),
    });
  }
  if (process.env.OPENROUTER_API_KEY) {
    out.push({
      id: "openrouter",
      key: process.env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      models: list("OPENROUTER_MODELS", null), // null = openrouter/free + live discovery
    });
  }
  return out;
}

async function buildCandidates(preferred) {
  const all = [];
  for (const p of configuredProviders()) {
    let models = p.models;
    if (p.id === "openrouter" && !models) {
      models = ["openrouter/free", ...(await discoverOpenRouterFree())];
    }
    for (const m of models) all.push({ provider: p, model: m });
  }
  if (preferred && preferred !== "auto") {
    const idx = all.findIndex((c) => `${c.provider.id}:${c.model}` === preferred);
    if (idx > 0) all.unshift(all.splice(idx, 1)[0]);
  }
  return all;
}

// ---------- streaming helpers ----------
async function* readTokens(reader) {
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const text = JSON.parse(data).choices?.[0]?.delta?.content;
        if (text) yield text;
      } catch (_) {}
    }
  }
}

function headersFor(c) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${c.provider.key}` };
}

function bodyFor(c, extra) {
  const body = { messages: undefined, ...extra };
  if (c.model !== "default") body.model = c.model;
  return body;
}

async function openStream(c, messages) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FIRST_TOKEN_TIMEOUT_MS);
  try {
    const r = await fetch(c.provider.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: headersFor(c),
      body: JSON.stringify(bodyFor(c, { messages, stream: true, max_tokens: 2048 })),
    });
    if (!r.ok) {
      const detail = (await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 160);
      throw new Error(`HTTP ${r.status} ${detail}`);
    }
    const iter = readTokens(r.body.getReader());
    const first = await iter.next();
    if (first.done) throw new Error("empty response");
    clearTimeout(timer);
    return { iter, first: first.value };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error(`no response in ${FIRST_TOKEN_TIMEOUT_MS / 1000}s`);
    throw e;
  }
}

// Non-streaming single call (used to plan search queries)
async function completeOnce(c, messages, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(c.provider.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: headersFor(c),
      body: JSON.stringify(bodyFor(c, { messages, stream: false, max_tokens: 500 })),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return j.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

// ---------- web search (Tavily) ----------
async function tavily(query) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
      body: JSON.stringify({ query, max_results: 4, search_depth: "basic" }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return (j.results || []).map((x) => ({ title: x.title || x.url, url: x.url, content: (x.content || "").slice(0, 500) }));
  } finally {
    clearTimeout(timer);
  }
}

async function planQueries(candidates, clean) {
  const last = clean[clean.length - 1].content.slice(0, 200);
  const ask = [
    {
      role: "system",
      content:
        "Output ONLY a JSON array of 1 to 3 short web search queries that would help answer the user's last message. " +
        "If no web search is needed, output []. Today is " + today() + ".",
    },
    { role: "user", content: clean.slice(-6).map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join("\n") },
  ];
  for (const c of candidates.slice(0, 2)) {
    try {
      const text = await completeOnce(c, ask, 8000);
      const m = text.match(/\[[\s\S]*?\]/);
      if (m) {
        const arr = JSON.parse(m[0]).filter((q) => typeof q === "string" && q.trim()).slice(0, 3);
        return arr;
      }
    } catch (_) {}
  }
  return [last];
}

async function gatherSources(candidates, clean) {
  const queries = await planQueries(candidates, clean);
  if (!queries.length) return [];
  const settled = await Promise.allSettled(queries.map(tavily));
  const seen = new Set();
  const sources = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const item of s.value) {
      if (!item.url || seen.has(item.url)) continue;
      seen.add(item.url);
      sources.push(item);
    }
  }
  return sources.slice(0, 8);
}

// ---------- handler ----------
module.exports = async (req, res) => {
  if (req.method === "GET") {
    const providers = configuredProviders().map((p) => ({ id: p.id, models: p.models || ["openrouter/free (+auto-discovered)"] }));
    res.status(200).json({ ok: true, providers, webSearch: !!process.env.TAVILY_API_KEY });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const clean = (Array.isArray(body.messages) ? body.messages : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));

  if (!clean.length || clean[clean.length - 1].role !== "user") {
    res.status(400).json({ error: "No message provided." });
    return;
  }

  const candidates = await buildCandidates(body.model);
  if (!candidates.length) {
    res.status(500).json({
      error:
        "No AI provider is configured. In Vercel add API_BASE + API_KEY, or GROQ_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY, then redeploy.",
    });
    return;
  }

  let searchStatus = "off";
  let sources = [];
  let system = systemPrompt();
  if (body.search) {
    if (!process.env.TAVILY_API_KEY) {
      searchStatus = "no-key";
    } else {
      try {
        sources = await gatherSources(candidates, clean);
        searchStatus = sources.length ? "used" : "none-found";
      } catch (_) {
        searchStatus = "failed";
      }
      if (sources.length) {
        system +=
          "\n\nWeb search results are below. Use them for facts that may be recent, and cite them like [1], [2]. " +
          "If they do not answer the question, say so.\n" +
          sources.map((s, i) => `[${i + 1}] ${s.title} (${s.url})\n${s.content}`).join("\n\n");
      }
    }
  }

  const messages = [{ role: "system", content: system }, ...clean];
  const failures = [];

  for (const c of candidates) {
    const name = `${c.provider.id}:${c.model}`;
    try {
      const { iter, first } = await openStream(c, messages);
      res.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Model-Used": name,
        "X-Search": searchStatus,
      });
      res.write(first);
      try {
        for await (const t of iter) res.write(t);
      } catch (_) {
        res.write("\n\n[Reply was cut off. Please try again.]");
      }
      if (sources.length) {
        const safe = (s) => s.replace(/[\[\]\r\n]/g, " ").slice(0, 90);
        res.write("\n\nSources:\n" + sources.map((s, i) => `${i + 1}. [${safe(s.title)}](${s.url.replace(/\)/g, "%29")})`).join("\n"));
      }
      res.end();
      return;
    } catch (e) {
      failures.push(`${name}: ${e.message}`);
    }
  }

  res.status(502).json({
    error: "All models failed or were too slow. Try again in a minute.",
    details: failures,
  });
};
