/**
 * Client-side AI helpers for Vitalis.
 *
 * Talks to the Vercel serverless proxy at /api/ai. The proxy uses a FREE,
 * keyless AI provider by default (Pollinations.ai), so no API key is needed.
 * If the proxy or network fails, the app falls back to local, offline
 * guidance so the product still works everywhere.
 */
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore'
import { db } from './firebase'

export async function getAIStatus() {
  try {
    const res = await fetch('/api/ai', { headers: { Accept: 'application/json' } })
    if (!res.ok) return { available: false, model: null, provider: null, free: false }
    return await res.json()
  } catch {
    return { available: false, model: null, provider: null, free: false }
  }
}

/**
 * Ask the AI assistant a question.
 * @param {{ messages: Array<{role:'user'|'assistant', content:string}>, context?: string }} input
 * @returns {Promise<{ reply: string, model?: string, provider?: string, free?: boolean, offline: boolean }>}
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
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.reply) {
      return { reply: offlineChatReply(), offline: true }
    }
    return {
      reply: data.reply,
      model: data.model,
      provider: data.provider,
      free: data.free,
      offline: false,
    }
  } catch {
    return { reply: offlineChatReply(), offline: true }
  }
}

export function offlineChatReply() {
  return (
    "I can't reach the AI service right now, so here is general guidance instead of a personalized answer. " +
    'For any symptom that is severe, sudden, or worrying — especially chest pain, trouble breathing, ' +
    'or signs of a stroke — please seek in-person care immediately. Rest and fluids help with many ' +
    'everyday complaints; if something persists or worsens, speak with a clinician. ' +
    '(The AI assistant is free and needs no API key — if you keep seeing this, check your internet connection.)'
  )
}

/**
 * Pull a small summary of the signed-in user's latest saved records from
 * Firestore to give the AI helpful, private context.
 * @returns {Promise<string|null>}
 */
export async function getUserHealthContext(user) {
  if (!user || !db) return null
  const parts = []
  try {
    const assessmentSnap = await getDocs(
      query(collection(db, 'users', user.uid, 'assessments'), orderBy('createdAt', 'desc'), limit(1))
    )
    if (!assessmentSnap.empty) {
      const a = assessmentSnap.docs[0].data()
      parts.push(
        `Most recent symptom check: ${(a.symptoms || []).join(', ') || 'none'} — guidance level: ${a.urgency || 'n/a'}`
      )
    }
  } catch {
    /* context is optional */
  }
  try {
    const checkinSnap = await getDocs(
      query(collection(db, 'users', user.uid, 'checkIns'), orderBy('createdAt', 'desc'), limit(1))
    )
    if (!checkinSnap.empty) {
      const c = checkinSnap.docs[0].data()
      parts.push(`Most recent daily check-in: ${(c.answers || []).filter(Boolean).join('; ') || 'incomplete'}`)
    }
  } catch {
    /* context is optional */
  }
  return parts.length ? parts.join('. ') + '.' : null
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
