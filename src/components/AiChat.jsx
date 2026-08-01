import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Sparkles, X } from 'lucide-react'
import { askAI, getAIStatus } from '../ai'

const QUICK_QUESTIONS = [
  'I have a headache and feel tired — what should I do?',
  'When should I worry about a fever?',
  'How can I manage stress?',
]

export default function AiChat() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState(null) // null | {available}
  const bottomRef = useRef(null)

  useEffect(() => {
    getAIStatus().then(setStatus).catch(() => setStatus({ available: false }))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy, open])

  const send = async (text) => {
    const content = (text || input).trim()
    if (!content || busy) return
    setInput('')
    setMessages((m) => [...m, { role: 'user', content }])
    setBusy(true)
    const result = await askAI({
      messages: [...messages, { role: 'user', content }],
    })
    setBusy(false)
    setMessages((m) => [...m, { role: 'assistant', content: result.reply }])
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
                  ? 'Connected · general guidance only'
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
          <p className="ai-chat-foot">Not medical advice. Emergencies → call local services.</p>
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
