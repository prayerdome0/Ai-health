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
    if (!res.ok) return { available: false, model: null, provider: null, free: false, languages: [] }
    return await res.json()
  } catch {
    return { available: false, model: null, provider: null, free: false, languages: [] }
  }
}

/**
 * Ask the AI assistant a question. Supports both JSON and streaming modes.
 *
 * @param {{
 *   messages: Array<{role:'user'|'assistant', content:string}>,
 *   context?: string,
 *   language?: string,
 *   onDelta?: (text: string) => void,
 *   signal?: AbortSignal,
 * }} input
 * @returns {Promise<{ reply: string, model?: string, provider?: string, free?: boolean, offline: boolean, aborted?: boolean }>}
 */
export async function askAI({ messages, context, language, onDelta, signal }) {
  const body = { messages }
  if (context) body.context = context
  if (language) body.language = language
  if (onDelta) body.stream = true

  // ── Streaming branch ──────────────────────────────────────────────────────
  if (onDelta) {
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal,
      })
      if (!res.ok || !res.body) {
        return { reply: offlineChatReply(language), offline: true }
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let reply = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let idx
        while ((idx = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, idx).trim()
          buffer = buffer.slice(idx + 1)
          if (!line || line.startsWith(':')) continue
          const data = line.startsWith('data:') ? line.slice(5).trim() : line
          if (!data) continue
          if (data === '[DONE]') continue
          try {
            const obj = JSON.parse(data)
            if (obj?.error) {
              return { reply: offlineChatReply(language), offline: true }
            }
            if (typeof obj?.delta === 'string' && obj.delta) {
              reply += obj.delta
              onDelta(obj.delta)
            } else if (obj?.done && typeof obj.reply === 'string') {
              // Final aggregated payload (in case deltas were missed).
              if (!reply && obj.reply) {
                reply = obj.reply
                onDelta(reply)
              }
            }
          } catch {
            /* ignore partial lines */
          }
        }
      }
      return { reply, offline: false }
    } catch (err) {
      if (err?.name === 'AbortError') {
        return { reply: '', offline: true, aborted: true }
      }
      return { reply: offlineChatReply(language), offline: true }
    }
  }

  // ── JSON (non-streaming) branch ──────────────────────────────────────────
  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.reply) {
      return { reply: offlineChatReply(language), offline: true }
    }
    return {
      reply: data.reply,
      model: data.model,
      provider: data.provider,
      free: data.free,
      offline: false,
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { reply: '', offline: true, aborted: true }
    }
    return { reply: offlineChatReply(language), offline: true }
  }
}

export function offlineChatReply(language = 'en') {
  // A handful of offline phrases in common languages. Falls back to English.
  const byLang = {
    en: "I can't reach the AI service right now, so here is general guidance instead of a personalized answer. For any symptom that is severe, sudden, or worrying — especially chest pain, trouble breathing, or signs of a stroke — please seek in-person care immediately. Rest and fluids help with many everyday complaints; if something persists or worsens, speak with a clinician.",
    es: 'No puedo contactar con el servicio de IA ahora mismo, así que aquí tienes orientación general. Para cualquier síntoma grave, repentino o preocupante — especialmente dolor en el pecho, dificultad para respirar o signos de un ACV — busca atención presencial de inmediato. Descanso e hidratación ayudan en muchos malestares comunes; si algo persiste o empeora, consulta a un profesional.',
    fr: "Je n'arrive pas à joindre le service d'IA pour l'instant, voici donc des conseils généraux. Pour tout symptôme grave, soudain ou préoccupant — surtout une douleur thoracique, des difficultés à respirer ou des signes d'AVC — consultez immédiatement en personne. Le repos et l'hydratation aident pour de nombreux petits maux ; si quelque chose persiste ou s'aggrave, parlez-en à un clinicien.",
    pt: 'Não consigo contactar o serviço de IA agora, então aqui vai uma orientação geral. Para qualquer sintoma grave, súbito ou preocupante — especialmente dor no peito, dificuldade para respirar ou sinais de AVC — procure atendimento presencial imediatamente. Repouso e líquidos ajudam em muitos desconfortos comuns; se algo persistir ou piorar, fale com um profissional.',
    sw: 'Hivi sasa siwezi kufikia huduma ya AI, kwa hivyo hii ni mwongozo wa jumla. Kwa dalili yoyote kali, ya ghafla, au inayowasumbua — hasa maumivu ya kifua, ugumu wa kupumua, au dalili za kiharusi — tafuta huduma ya haraka. Kupumzika na kunywa maji husaidia kwa matatizo mengi ya kawaida; ikiwa kitu kinaendelea au kinaongezeka, zungumza na mtaalamu.',
    ar: 'لا أستطيع الوصول إلى خدمة الذكاء الاصطناعي الآن، لذلك هذه إرشادات عامة. لأي عرض حاد أو مفاجئ أو مقلق — خاصة ألم الصدر، أو صعوبة التنفس، أو علامات السكتة الدماغية — يُرجى طلب الرعاية الشخصية فوراً. الراحة والترطيب تساعدان في كثير من الشكاوى اليومية؛ إن استمرّ شيء أو ساء، استشر طبيباً.',
  }
  return (
    byLang[language] || byLang.en
  ) + ' (AI assistant is free and needs no key — if you keep seeing this, check your internet connection.)'
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

/* ──────────────────────────────────────────────────────────────────────────
 *  Safety pre-screen (#3)
 *  Runs entirely on the client so the user sees a "Call for help" banner
 *  immediately, even before — or instead of — the AI's reply.
 * ──────────────────────────────────────────────────────────────────────── */

/** Phrases in any language that indicate a likely medical emergency. */
const URGENT_PATTERNS = [
  // English
  /\b(chest pain|chest pressure|can'?t breathe|cannot breathe|trouble breathing|short of breath|stroke|face drooping|slurred speech|suicid|kill myself|want to die|unconscious|fainted|passed out|severe bleeding|heavy bleeding|overdose|allergic reaction|swollen tongue|anaphyla)\b/i,
  // Spanish
  /(dolor (en el )?pecho|no puedo respirar|dificultad para respirar|accidente cerebrovascular|derrame cerebral|cara caída|habla arrastrada|suicid|matarme|quiero morir|desmayo|inconsciente|sangrado severo|sangrado abundante|reacción alérgica|anafilaxia)/i,
  // French
  /(douleur (à la )?poitrine|je ne peux pas respirer|difficulté à respirer|AVC|accident vasculaire|visage affaissé|parole trouble|suicid|tuer|envie de mourir|évanoui|inconscient|hémorragie|réaction allergique|anaphylaxie)/i,
  // Portuguese
  /(dor (no )?peito|não consigo respirar|dificuldade para respirar|AVC|derrame|rosto caído|fala arrastada|suicid|matar-me|quero morrer|desmaio|inconsciente|sangramento intenso|reação alérgica|anafilaxia)/i,
  // Swahili
  /(maumivu ya kifua|sipumui|ugumu wa kupumua|kiharusi|saratani|husema|jitakie|kufa|kuzimia|kupoteza fahamu|damu nyingi|mzio)/i,
  // Arabic
  /(ألم (في )?الصدر|لا أستطيع التنفس|صعوبة في التنفس|سكتة دماغية|وجه متدلٍ|كلام غير واضح|انتحار|أريد أن أموت|فقدت الوعي|نزيف شديد|رد فعل تحسسي)/,
]

/**
 * @param {string} text
 * @returns {{ urgent: boolean, matches: string[], suggestedAction: string|null }}
 */
export function detectUrgentContent(text) {
  if (!text || typeof text !== 'string') {
    return { urgent: false, matches: [], suggestedAction: null }
  }
  const matches = []
  for (const re of URGENT_PATTERNS) {
    const m = text.match(re)
    if (m && m[0]) matches.push(m[0])
  }
  if (!matches.length) return { urgent: false, matches: [], suggestedAction: null }
  return {
    urgent: true,
    matches: Array.from(new Set(matches)).slice(0, 4),
    suggestedAction:
      'This sounds like it could be a medical emergency. If you can, please call your local emergency number now or go to the nearest hospital.',
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 *  Languages (#2)
 * ──────────────────────────────────────────────────────────────────────── */

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
