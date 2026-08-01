/**
 * Vitalis AI proxy — Vercel serverless function.
 *
 * POST /api/ai   { messages: [{ role, content }], context? }
 *   -> { reply, model, provider }  when an AI provider is configured
 *   -> 503 { available: false, reason }  when no provider is configured
 * GET  /api/ai
 *   -> { available: boolean, model }
 *
 * Configure any OpenAI-compatible provider with environment variables:
 *   AI_API_KEY   (or OPENAI_API_KEY)  - provider API key
 *   AI_BASE_URL  (default https://api.openai.com/v1)
 *   AI_MODEL     (default gpt-4o-mini)
 */

const DEFAULT_MODEL = 'gpt-4o-mini'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const MAX_HISTORY = 12
const MAX_USER_MESSAGE = 3000

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
6. Reply in the same language the user writes in.
7. Never claim to have access to the user's saved records unless they are included
   in the message you receive.`

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

export default async function handler(req, res) {
  cors(res)

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || ''
  const baseUrl = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = process.env.AI_MODEL || DEFAULT_MODEL

  const config = {
    available: Boolean(apiKey),
    model,
    provider: apiKey ? new URL(baseUrl).hostname : null,
  }

  if (req.method === 'GET') {
    res.status(200).json(config)
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  if (!config.available) {
    res.status(503).json({
      available: false,
      reason: 'AI is not configured yet. Add the AI_API_KEY environment variable in Vercel to enable the AI assistant.',
    })
    return
  }

  let messages = []
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    messages = Array.isArray(body?.messages) ? body.messages : []
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' })
    return
  }

  const sanitized = messages
    .filter(
      (m) =>
        m &&
        typeof m.content === 'string' &&
        (m.role === 'user' || m.role === 'assistant' || m.role === 'system')
    )
    .map((m) => ({
      role: m.role,
      content: m.content.slice(0, MAX_USER_MESSAGE),
    }))
    .slice(-MAX_HISTORY)

  const payload = {
    model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...sanitized],
    max_tokens: 700,
    temperature: 0.4,
  }

  try {
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
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

    res.status(200).json({ reply, model, provider: config.provider })
  } catch (err) {
    console.error('AI proxy failure:', err)
    res.status(502).json({ error: 'Could not reach the AI provider.' })
  }
}
