/**
 * Vitalis AI proxy — Vercel serverless function.
 *
 * FREE BY DEFAULT — no API key required.
 *   Uses Pollinations.ai (https://text.pollinations.ai/openai), a free,
 *   keyless, OpenAI-compatible provider (free models cost 0 credits).
 *   Rate-limited to ~1 request / 5s on the free tier.
 *
 * OPTIONAL UPGRADE — set environment variables for any OpenAI-compatible
 * provider (or to raise Pollinations limits with a free registered key):
 *   AI_API_KEY          (or OPENAI_API_KEY) - provider API key
 *   AI_BASE_URL         (default https://api.openai.com/v1)
 *   AI_MODEL            (default gpt-4o-mini when a key is set;
 *                        default "openai" on the free provider)
 *
 * POST /api/ai   { messages: [{ role, content }], context?, language? }
 *   -> application/json (default)   { reply, model, provider, free }
 *   -> text/event-stream (stream)   data: { delta }  ...  data: [DONE]
 * GET  /api/ai
 *   -> { available, model, provider, free, languages }
 *
 * The stream mode is used by the client when the client sends
 * "Accept: text/event-stream" or "stream: true" in the body.
 */

const FREE_ENDPOINT = 'https://text.pollinations.ai/openai'
const FREE_MODEL = 'openai'
const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_HISTORY = 12
const MAX_USER_MESSAGE = 3000
const MAX_CONTEXT = 2000

const SYSTEM_PROMPT = `You are Vitalis, the health guidance assistant inside a wellness app.

Your job is to give calm, safety-first health guidance. Follow these rules strictly:

1. You are NOT a doctor and must NEVER give a diagnosis. Frame everything as general
   wellness guidance and next steps, not medical conclusions.
2. Whenever symptoms could be serious (chest pain, severe breathing difficulty,
   stroke signs like facial droop or slurred speech, severe bleeding, loss of
   consciousness, suicidal thoughts, feeling unsafe), tell the person to seek
   urgent in-person or emergency care immediately, and keep that instruction first.
3. Be concise and practical: 3-6 short sentences or a short bulleted list.
4. For routine concerns, suggest rest, hydration, monitoring, and speaking with a
   clinician if symptoms persist, worsen, or worry them.
5. Do not invent facts, medications, doses, or statistics. If you are not sure,
   say so and advise consulting a qualified healthcare professional.
6. Reply in the same language the user writes in. If the user wrote in
   ${'{{LANGUAGE}}'}, reply in ${'{{LANGUAGE}}'}.
7. Never claim to have access to the user's saved records unless they are included
   in the context you receive.`

// Languages the AI chat UI exposes. The model is told to reply in the chosen
// language as a soft hint, but rule #6 (mirror the user's language) wins.
export const SUPPORTED_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'pt', label: 'Português' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ar', label: 'العربية' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'ru', label: 'Русский' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'vi', label: 'Tiếng Việt' },
]

function labelFor(code) {
  const m = SUPPORTED_LANGUAGES.find((l) => l.code === code)
  return m ? m.label : 'English'
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept')
  res.setHeader('Access-Control-Expose-Headers', 'X-AI-Model, X-AI-Provider')
}

function buildSystemPrompt(languageCode) {
  const label = labelFor(languageCode)
  return SYSTEM_PROMPT.replaceAll('{{LANGUAGE}}', label)
}

function providerConfig() {
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || ''
  const free = !apiKey
  if (free) {
    return {
      free: true,
      mode: 'free',
      model: process.env.AI_MODEL || FREE_MODEL,
      provider: 'pollinations.ai (free, no key)',
      endpoint: FREE_ENDPOINT,
      headers: {},
    }
  }
  const base = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return {
    free: false,
    mode: 'openai',
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    provider: base.replace(/^https?:\/\//, ''),
    endpoint: `${base}/chat/completions`,
    headers: { Authorization: `Bearer ${apiKey}` },
  }
}

function wantsStream(req) {
  const accept = String(req.headers?.accept || '').toLowerCase()
  if (accept.includes('text/event-stream')) return true
  // Body is already parsed by Vercel for JSON POSTs, so we can read it here.
  if (req.body && typeof req.body === 'object' && req.body.stream === true) return true
  return false
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
  // Flush so the browser receives chunks immediately instead of buffering.
  if (typeof res.flush === 'function') {
    try {
      res.flush()
    } catch {
      /* not all runtimes support flush */
    }
  }
}

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter(
      (m) =>
        m &&
        typeof m.content === 'string' &&
        (m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    )
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_USER_MESSAGE) }))
    .slice(-MAX_HISTORY)
}

function clampContext(ctx) {
  return typeof ctx === 'string' ? ctx.slice(0, MAX_CONTEXT) : ''
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return null
    }
  }
  return null
}

async function handleJson(req, res, config, system, sanitized) {
  const payload =
    config.mode === 'free'
      ? {
          model: config.model,
          messages: [{ role: 'system', content: system }, ...sanitized],
          temperature: 0.4,
          seed: 42,
          private: true,
        }
      : {
          model: config.model,
          messages: [{ role: 'system', content: system }, ...sanitized],
          max_tokens: 700,
          temperature: 0.4,
        }

  const upstream = await fetch(config.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...config.headers },
    body: JSON.stringify(payload),
  })
  const data = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    console.error('AI upstream error:', upstream.status, JSON.stringify(data).slice(0, 500))
    res.status(502).json({
      error: 'The AI provider returned an error.',
      detail: data?.error?.message || upstream.statusText,
    })
    return
  }
  const reply = data?.choices?.[0]?.message?.content
  if (!reply) {
    res.status(502).json({ error: 'The AI provider returned an empty response.' })
    return
  }
  res.setHeader('X-AI-Model', config.model)
  res.setHeader('X-AI-Provider', config.provider)
  res.status(200).json({ reply, model: config.model, provider: config.provider, free: config.free })
}

async function handleStream(req, res, config, system, sanitized) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-AI-Model', config.model)
  res.setHeader('X-AI-Provider', config.provider)
  res.status(200)
  res.write(': ok\n\n')

  const payload =
    config.mode === 'free'
      ? {
          model: config.model,
          messages: [{ role: 'system', content: system }, ...sanitized],
          temperature: 0.4,
          seed: 42,
          private: true,
          stream: true,
        }
      : {
          model: config.model,
          messages: [{ role: 'system', content: system }, ...sanitized],
          max_tokens: 700,
          temperature: 0.4,
          stream: true,
        }

  let upstream
  try {
    upstream = await fetch(config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...config.headers, Accept: 'text/event-stream' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    console.error('AI stream fetch failed:', err)
    sseWrite(res, { error: 'Could not reach the AI provider.' })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => '')
    console.error('AI stream upstream error:', upstream.status, txt.slice(0, 500))
    sseWrite(res, { error: 'The AI provider returned an error.' })
    res.write('data: [DONE]\n\n')
    res.end()
    return
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullReply = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE-style events use \n\n, but Pollinations (OpenAI-compatible) sends
      // each line as "data: {json}\n". We split on newlines and handle both.
      let idx
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) continue
        if (line.startsWith(':')) continue // comment / keepalive
        const data = line.startsWith('data:') ? line.slice(5).trim() : line
        if (!data || data === '[DONE]') continue
        try {
          const obj = JSON.parse(data)
          const delta =
            obj?.choices?.[0]?.delta?.content ??
            obj?.choices?.[0]?.message?.content ??
            ''
          if (delta) {
            fullReply += delta
            sseWrite(res, { delta })
          }
        } catch {
          // ignore unparseable lines; the next chunk may complete them
        }
      }
    }
  } catch (err) {
    console.error('AI stream read error:', err)
    sseWrite(res, { error: 'The AI stream was interrupted.' })
  } finally {
    sseWrite(res, { done: true, reply: fullReply, model: config.model, free: config.free })
    res.write('data: [DONE]\n\n')
    res.end()
  }
}

export default async function handler(req, res) {
  cors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const config = providerConfig()

  if (req.method === 'GET') {
    res.status(200).json({
      available: true,
      model: config.model,
      provider: config.provider,
      free: config.free,
      languages: SUPPORTED_LANGUAGES,
    })
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = await readJsonBody(req)
  if (!body) {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  const messages = sanitizeMessages(body.messages)
  const context = clampContext(body.context)
  const language = typeof body.language === 'string' ? body.language.slice(0, 8) : 'en'
  const stream = wantsStream(req) || body.stream === true

  const system = buildSystemPrompt(language) +
    (context ? `\n\nContext from the user's saved records (private, only for this conversation):\n${context}` : '')

  if (stream) {
    await handleStream(req, res, config, system, messages)
    return
  }
  await handleJson(req, res, config, system, messages)
}
