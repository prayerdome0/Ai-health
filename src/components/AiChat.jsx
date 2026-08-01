import { useEffect, useRef, useState } from 'react'
import { collection, addDoc, getDocs, limit, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { Bot, Send, Sparkles, X } from 'lucide-react'
import { askAI, getAIStatus, getUserHealthContext } from '../ai'
import { db } from '../firebase'

const QUICK_QUESTIONS = [
  'I have a headache and feel tired — what should I do?',
  'When should I worry about a fever?',
  'How can I manage stress?',
]

const HISTORY_LIMIT = 60

export default function AiChat({ user }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // null | {available, free, provider}
  const [historyLoaded, setHistoryLoaded] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    getAIStatus().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

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

  const send = async (text) => {
    const content = (text || input).trim()
    if (!content || busy) return
    setInput('')
    const updated = [...messages, { role: 'user', content }]
    setMessages(updated)
    setBusy(true)

    // Attach the user's latest saved records (Firebase context) when signed in.
    const context = user ? await getUserHealthContext(user) : null
    const result = await askAI({ messages: updated, context })

    setBusy(false)
    setMessages([...updated, { role: 'assistant', content: result.reply }])
    persist('user', content)
    persist('assistant', result.reply)
  }

  return (
    <>
      {open && (
        <div className="ai-chat" role="dialog" aria-label="Vitalis AI assistant">
          <div className="ai-chat-head">
            <span className="ai-chat-logo">
              <Bot size={18} />
            </span>
            <div>
              <strong>Vitalis AI</strong>
              <p>
                {status?.available
                  ? status.free
                    ? 'Free AI · connected'
                    : 'AI · connected'
                  : 'Offline mode · basic guidance'}
              </p>
            </div>
            <button className="ai-chat-close" onClick={() => setOpen(false)} aria-label="Close chat">
              <X size={16} />
            </button>
          </div>
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
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble ${m.role}`}>
                {m.content}
              </div>
            ))}
            {busy && <div className="chat-bubble assistant typing">Thinking…</div>}
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
              placeholder="Ask about symptoms, sleep, stress…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button type="submit" disabled={busy || !input.trim()} aria-label="Send">
              <Send size={16} />
            </button>
          </form>
          <p className="ai-chat-foot">
            {user
              ? 'Chat history saved to your private account · Not medical advice'
              : 'Not medical advice · Sign in to save your chat history'}
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
