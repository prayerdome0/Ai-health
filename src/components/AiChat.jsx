import { useEffect, useRef, useState } from 'react'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import {
  AlertTriangle,
  Bot,
  Check,
  Copy,
  Globe,
  Languages,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  X,
} from 'lucide-react'
import { askAI, detectUrgentContent, getAIStatus, getUserHealthContext, SUPPORTED_LANGUAGES } from '../ai'
import { db } from '../firebase'

const QUICK_QUESTIONS = [
  'I have a headache and feel tired — what should I do?',
  'When should I worry about a fever?',
  'How can I manage stress?',
]

const HISTORY_LIMIT = 60
const LANG_STORAGE_KEY = 'vitalis_ai_language'

const URGENT_GREETINGS = {
  en: 'This sounds urgent',
  es: 'Esto parece urgente',
  fr: 'Cela semble urgent',
  pt: 'Isto parece urgente',
  sw: 'Hii inaonekana ya dharura',
  ar: 'هذا يبدو عاجلاً',
}

export default function AiChat({ user }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // null | {available, free, provider, languages}
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const [language, setLanguage] = useState(() => {
    try {
      return localStorage.getItem(LANG_STORAGE_KEY) || 'en'
    } catch {
      return 'en'
    }
  })
  const [showLangMenu, setShowLangMenu] = useState(false)
  const [urgentAlert, setUrgentAlert] = useState(null) // { matches, suggestedAction }
  const [copiedIdx, setCopiedIdx] = useState(null)
  const abortRef = useRef(null)
  const bottomRef = useRef(null)
  const langMenuRef = useRef(null)

  useEffect(() => {
    getAIStatus().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(LANG_STORAGE_KEY, language)
    } catch {
      /* ignore */
    }
  }, [language])

  // Close language menu when clicking outside.
  useEffect(() => {
    if (!showLangMenu) return
    const onClick = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setShowLangMenu(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [showLangMenu])

  // Load the signed-in user's saved chat history from Firestore once.
  useEffect(() => {
    if (!user || historyLoaded) return
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'chatMessages'),
            orderBy('createdAt', 'asc'),
            limit(HISTORY_LIMIT)
          )
        )
        if (!alive || snap.empty) return
        setMessages(
          snap.docs.map((d) => ({ role: d.data().role, content: d.data().content }))
        )
      } catch (err) {
        console.warn('Could not load chat history:', err)
      } finally {
        if (alive) setHistoryLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [user, historyLoaded])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy, open])

  const persist = async (role, content) => {
    if (!user) return
    try {
      await addDoc(collection(db, 'users', user.uid, 'chatMessages'), {
        role,
        content,
        createdAt: serverTimestamp(),
      })
    } catch (err) {
      console.warn('Could not save chat message:', err)
    }
  }

  const stop = () => {
    if (abortRef.current) {
      abortRef.current.abort()
      abortRef.current = null
    }
    setBusy(false)
  }

  const send = async (text) => {
    const content = (text || input).trim()
    if (!content || busy) return
    setInput('')
    setUrgentAlert(null)
    setCopiedIdx(null)

    // Pre-screen for urgent content so we can show the safety banner even
    // before the AI reply starts streaming.
    const urgent = detectUrgentContent(content)
    if (urgent.urgent) setUrgentAlert(urgent)

    const updated = [...messages, { role: 'user', content }]
    setMessages(updated)
    setBusy(true)

    const controller = new AbortController()
    abortRef.current = controller

    // Attach the user's latest saved records (Firebase context) when signed in.
    const context = user ? await getUserHealthContext(user) : null

    let liveReply = ''
    setMessages((m) => [...m.slice(0, -1).concat(updated, { role: 'assistant', content: '' })])

    const result = await askAI({
      messages: updated,
      context,
      language,
      signal: controller.signal,
      onDelta: (delta) => {
        liveReply += delta
        setMessages((m) => {
          const next = m.slice()
          // Replace the trailing empty assistant bubble in place.
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === 'assistant' && next[i].content === '' && !next[i].final) {
              next[i] = { ...next[i], content: liveReply }
              break
            }
            if (next[i].role === 'assistant' && !next[i].final) {
              next[i] = { ...next[i], content: liveReply }
              break
            }
          }
          return next
        })
      },
    })

    abortRef.current = null
    setBusy(false)

    if (result.aborted) {
      // User pressed stop. Keep whatever streamed so far.
      setMessages((m) => m.map((mm, i) => (i === m.length - 1 ? { ...mm, final: true } : mm)))
      return
    }

    const finalReply = result.reply || liveReply
    setMessages((m) => {
      const next = m.slice()
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].role === 'assistant') {
          next[i] = { ...next[i], content: finalReply, final: true, offline: !!result.offline }
          break
        }
      }
      return next
    })

    persist('user', content)
    if (finalReply) persist('assistant', finalReply)
  }

  const regenerate = async () => {
    if (busy) return
    // Find the last user message and remove the trailing assistant message,
    // then re-send.
    let lastUser = null
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUser = messages[i].content
        break
      }
    }
    if (!lastUser) return
    setMessages((m) => {
      // Drop the trailing assistant message.
      const next = m.slice()
      while (next.length && next[next.length - 1].role !== 'user') next.pop()
      return next
    })
    await send(lastUser)
  }

  const clearChat = async () => {
    if (!confirm('Clear all messages in this chat?')) return
    setMessages([])
    if (!user) return
    try {
      const snap = await getDocs(
        query(collection(db, 'users', user.uid, 'chatMessages'), limit(HISTORY_LIMIT))
      )
      await Promise.all(
        snap.docs.map((d) =>
          deleteDoc(doc(db, 'users', user.uid, 'chatMessages', d.id)).catch(() => {})
        )
      )
    } catch (err) {
      console.warn('Could not clear chat history:', err)
    }
  }

  const copy = async (idx) => {
    const text = messages[idx]?.content
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIdx(idx)
      setTimeout(() => setCopiedIdx(null), 1500)
    } catch {
      /* no-op */
    }
  }

  const speak = (text) => {
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text)
      u.lang = language || 'en'
      u.rate = 1
      window.speechSynthesis.speak(u)
    } catch {
      /* ignore */
    }
  }

  const activeLanguage =
    SUPPORTED_LANGUAGES.find((l) => l.code === language) || SUPPORTED_LANGUAGES[0]

  return (
    <>
      {open && (
        <div className="ai-chat" role="dialog" aria-label="Vitalis AI assistant">
          <div className="ai-chat-head">
            <span className="ai-chat-logo">
              <Bot size={18} />
            </span>
            <div className="ai-chat-title">
              <strong>Vitalis AI</strong>
              <p>
                {status?.available
                  ? status.free
                    ? 'Free AI · connected'
                    : 'AI · connected'
                  : 'Offline mode · basic guidance'}
                {activeLanguage && activeLanguage.code !== 'en' && (
                  <> · {activeLanguage.label}</>
                )}
              </p>
            </div>

            <div className="ai-lang" ref={langMenuRef}>
              <button
                className="ai-chat-icon-btn"
                onClick={() => setShowLangMenu((v) => !v)}
                aria-label="Change language"
                title="Language"
              >
                <Globe size={16} />
              </button>
              {showLangMenu && (
                <div className="ai-lang-menu" role="listbox">
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <button
                      key={l.code}
                      role="option"
                      aria-selected={l.code === language}
                      className={l.code === language ? 'selected' : ''}
                      onClick={() => {
                        setLanguage(l.code)
                        setShowLangMenu(false)
                      }}
                    >
                      {l.label}
                      {l.code === language && <Check size={13} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {messages.length > 0 && (
              <button
                className="ai-chat-icon-btn"
                onClick={clearChat}
                aria-label="Clear chat"
                title="Clear chat"
              >
                <Trash2 size={15} />
              </button>
            )}

            <button
              className="ai-chat-close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              <X size={16} />
            </button>
          </div>

          {urgentAlert && (
            <div className="ai-urgent" role="alert">
              <AlertTriangle size={18} />
              <div>
                <strong>
                  {(URGENT_GREETINGS[language] || URGENT_GREETINGS.en) +
                    (urgentAlert.matches.length ? ` · “${urgentAlert.matches.join(', ')}”` : '')}
                </strong>
                <p>{urgentAlert.suggestedAction}</p>
              </div>
              <a className="ai-urgent-call" href="tel:112">
                <Phone size={14} /> Call emergency
              </a>
            </div>
          )}

          <div className="ai-chat-body">
            {messages.length === 0 && (
              <div className="ai-welcome">
                <Sparkles size={18} />
                <p>
                  Hi, I'm Vitalis. I can help you think through symptoms and
                  wellness questions — but I never diagnose. For emergencies,
                  call your local emergency number.
                </p>
              </div>
            )}
            {messages.map((m, i) => {
              const isAssistant = m.role === 'assistant'
              const isLastAssistant =
                isAssistant && !messages.slice(i + 1).some((x) => x.role === 'assistant')
              const isEmpty = isAssistant && !m.content
              return (
                <div key={i} className={`ai-msg ${m.role}`}>
                  <div className={`chat-bubble ${m.role}${isEmpty ? ' typing' : ''}`}>
                    {isEmpty ? 'Thinking…' : m.content}
                    {m.offline && <span className="ai-offline-tag">offline</span>}
                  </div>
                  {isAssistant && m.content && (
                    <div className="ai-msg-actions">
                      <button
                        className="ai-msg-action"
                        onClick={() => copy(i)}
                        title="Copy"
                        aria-label="Copy reply"
                      >
                        {copiedIdx === i ? <Check size={13} /> : <Copy size={13} />}
                        <span>{copiedIdx === i ? 'Copied' : 'Copy'}</span>
                      </button>
                      <button
                        className="ai-msg-action"
                        onClick={() => speak(m.content)}
                        title="Read aloud"
                        aria-label="Read aloud"
                      >
                        <Volume2 size={13} />
                        <span>Speak</span>
                      </button>
                      {isLastAssistant && m.final && (
                        <button
                          className="ai-msg-action"
                          onClick={regenerate}
                          title="Regenerate"
                          aria-label="Regenerate reply"
                        >
                          <RefreshCw size={13} />
                          <span>Regenerate</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
            {busy && (
              <div className="ai-msg-stop">
                <button className="ai-stop-btn" onClick={stop} aria-label="Stop generating">
                  <Square size={12} /> Stop generating
                </button>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {messages.length === 0 && (
            <div className="ai-quick">
              {QUICK_QUESTIONS.map((q) => (
                <button key={q} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            className="ai-chat-input"
            onSubmit={(e) => {
              e.preventDefault()
              send()
            }}
          >
            <input
              placeholder={`Ask about symptoms, sleep, stress… (${activeLanguage.label})`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
            >
              <Send size={16} />
            </button>
          </form>
          <p className="ai-chat-foot">
            {user
              ? 'Chat history saved to your private account · Not medical advice'
              : 'Not medical advice · Sign in to save your chat history'}
            {' · '}
            <span className="ai-foot-lang">
              <Languages size={11} /> {activeLanguage.label}
            </span>
          </p>
        </div>
      )}
      <button
        className="ai-fab"
        onClick={() => setOpen(!open)}
        aria-label="Open AI assistant"
        title="Ask Vitalis AI"
      >
        {open ? <X size={20} /> : <Bot size={22} />}
      </button>
    </>
  )
}
