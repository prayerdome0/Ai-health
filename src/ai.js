/**
 * Client-side AI helpers for Vitalis.
 *
 * Talks to the Vercel serverless proxy at /api/ai. If the proxy reports that
 * no AI provider is configured (or the network fails), the app falls back to
 * local, offline guidance so the product still works everywhere.
 */

export async function getAIStatus() {
  try {
    const res = await fetch('/api/ai', { headers: { Accept: 'application/json' } })
    if (!res.ok) return { available: false, model: null }
    return await res.json()
  } catch {
    return { available: false, model: null }
  }
}

/**
 * Ask the AI assistant a question.
 * @param {{ messages: Array<{role:'user'|'assistant', content:string}>, context?: string }} input
 * @returns {Promise<{ reply: string, model?: string, offline: boolean }>}
 */
export async function askAI({ messages, context }) {
  const body = { messages }
  if (context) body.context = context
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.status === 503) {
      return { reply: offlineChatReply(), offline: true }
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.reply) {
      return { reply: offlineChatReply(), offline: true }
    }
    return { reply: data.reply, model: data.model, offline: false }
  } catch {
    return { reply: offlineChatReply(), offline: true }
  }
}

export function offlineChatReply() {
  return (
    "I'm in offline mode right now, so I'll share general guidance instead of a personalized answer. " +
    'For any symptom that is severe, sudden, or worrying — especially chest pain, trouble breathing, ' +
    'or signs of a stroke — please seek in-person care immediately. Rest and fluids help with many ' +
    'everyday complaints; if something persists or worsens, speak with a clinician. ' +
    '(Tip for the app owner: add the AI_API_KEY environment variable in Vercel to enable the full AI assistant.)'
  )
}

/** Turn a Firestore save error into a friendly, actionable message. */
export function friendlySaveError(err) {
  const code = err?.code || ''
  console.error('Vitalis save error:', err)
  switch (code) {
    case 'permission-denied':
      return 'Saving is blocked by the database rules. The app owner needs to deploy the updated firestore.rules (see README).'
    case 'unavailable':
    case 'network-request-failed':
      return 'The database is unreachable right now. Check your connection and try again.'
    case 'unauthenticated':
      return 'Your session expired. Please sign in again and retry.'
    default:
      return 'We could not save this right now. Please try again.'
  }
}
