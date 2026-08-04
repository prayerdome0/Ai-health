import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import { AlertTriangle, Baby, CalendarDays, NotebookPen, Sparkles, Trash2 } from 'lucide-react'
import { db } from '../../firebase'
import { friendlyFirestoreError } from '../../firestoreErrors'
import { askAI } from '../../ai'
import {
  offlineWeekTip,
  pregnancyWarningSigns,
  trimesterForWeek,
  weekMilestones,
} from '../../data/pregnancyMilestones'

const PREGNANCY_DAYS = 280

function computeInfo(dueDateStr, lmpStr) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  let lmp = null
  let due = null
  if (dueDateStr) {
    due = new Date(dueDateStr + 'T00:00:00')
    lmp = new Date(due.getTime() - PREGNANCY_DAYS * 86400000)
  } else if (lmpStr) {
    lmp = new Date(lmpStr + 'T00:00:00')
    due = new Date(lmp.getTime() + PREGNANCY_DAYS * 86400000)
  }
  if (!lmp || isNaN(lmp.getTime())) return null
  const days = Math.floor((now - lmp) / 86400000)
  const currentWeek = Math.max(0, Math.min(42, Math.floor(days / 7) + 1))
  const daysRemaining = Math.max(0, Math.ceil((due - now) / 86400000))
  return {
    due: due,
    lmp,
    currentWeek,
    currentDay: Math.max(0, days % 7),
    trimester: trimesterForWeek(currentWeek),
    daysRemaining,
    weeksRemaining: Math.max(0, Math.ceil(daysRemaining / 7)),
    progress: Math.min(100, Math.round((days / PREGNANCY_DAYS) * 100)),
  }
}

export default function PregnancyTracker({ user, onRequireAuth }) {
  const [mode, setMode] = useState(() => localStorage.getItem('vitalis_due_mode') || 'due')
  const [dueDate, setDueDate] = useState(() => localStorage.getItem('vitalis_due_date') || '')
  const [lmp, setLmp] = useState(() => localStorage.getItem('vitalis_lmp') || '')
  const [notes, setNotes] = useState([])
  const [noteText, setNoteText] = useState('')
  const [noteMsg, setNoteMsg] = useState('')
  const [tip, setTip] = useState('')
  const [tipLoading, setTipLoading] = useState(false)

  const info = useMemo(() => computeInfo(dueDate, lmp), [dueDate, lmp, mode])

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'users', user.uid, 'pregnancyNotes'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) =>
        setNotes(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }))
        ),
      (err) => console.warn('Could not load pregnancy notes:', err)
    )
    return unsub
  }, [user])

  const saveNote = async (e) => {
    e.preventDefault()
    if (!info) return setNoteMsg('Set a due date or last period first.')
    if (!noteText.trim()) return setNoteMsg('Write a short note first.')
    if (!user) return onRequireAuth()
    try {
      await addDoc(collection(db, 'users', user.uid, 'pregnancyNotes'), {
        week: info.currentWeek,
        notes: noteText.trim(),
        date: new Date().toISOString().slice(0, 10),
        createdAt: serverTimestamp(),
      })
      setNoteText('')
      setNoteMsg('')
    } catch (err) {
      console.error('Could not save pregnancy note:', err)
      setNoteMsg(friendlyFirestoreError(err, 'save'))
    }
  }

  const deleteNote = async (id) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'pregnancyNotes', id))
    } catch (err) {
      console.error('Could not delete note:', err)
      setNoteMsg(friendlyFirestoreError(err, 'delete'))
    }
  }

  const askTip = async () => {
    if (!info) return
    setTipLoading(true)
    setTip('')
    const result = await askAI({
      messages: [
        {
          role: 'user',
          content: `I am ${info.currentWeek} weeks pregnant (${info.currentDay} days into the week, ${info.daysRemaining} days to my due date). Give me one practical, encouraging tip for this week, plus any warning sign I should watch for. Keep it under 120 words.`,
        },
      ],
    })
    setTip(result.reply || offlineWeekTip(info.currentWeek))
    setTipLoading(false)
  }

  const setStored = (key, value) => {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  }

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <Baby size={14} /> WOMEN'S HEALTH
        </p>
        <h1>Pregnancy tracker.</h1>
        <p>
          Follow your week-by-week journey, capture notes for your clinician,
          and get timely guidance — all in one private place.
        </p>
      </div>

      <div className="tracker-grid">
        <div className="panel tracker-setup">
          <div className="panel-head">
            <div>
              <h2>Your dates</h2>
              <p>Enter your due date or the first day of your last period.</p>
            </div>
            <CalendarDays size={20} />
          </div>
          <div className="mode-row">
            <button className={mode === 'due' ? 'chip selected' : 'chip'} onClick={() => setMode('due')}>
              Due date
            </button>
            <button className={mode === 'lmp' ? 'chip selected' : 'chip'} onClick={() => setMode('lmp')}>
              Last period
            </button>
          </div>
          {mode === 'due' ? (
            <label className="auth-field">
              <span>Baby's due date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => {
                  setDueDate(e.target.value)
                  setLmp('')
                  setStored('vitalis_due_date', e.target.value)
                  setStored('vitalis_lmp', '')
                  setStored('vitalis_due_mode', 'due')
                }}
              />
            </label>
          ) : (
            <label className="auth-field">
              <span>First day of last period</span>
              <input
                type="date"
                value={lmp}
                onChange={(e) => {
                  setLmp(e.target.value)
                  setDueDate('')
                  setStored('vitalis_lmp', e.target.value)
                  setStored('vitalis_due_date', '')
                  setStored('vitalis_due_mode', 'lmp')
                }}
              />
            </label>
          )}

          {info && (
            <div className="week-hero">
              <div className="week-badge">
                <strong>{info.currentWeek}</strong>
                <span>weeks</span>
              </div>
              <div className="week-facts">
                <p>
                  <strong>{info.trimester.label}</strong> ({info.trimester.weeks})
                </p>
                <p>
                  {info.daysRemaining} days to go · ~{info.weeksRemaining} weeks
                  remaining
                </p>
                <p>Day {info.currentDay} of week {info.currentWeek}</p>
              </div>
            </div>
          )}

          {info && (
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${info.progress}%` }} />
            </div>
          )}

          {!info && <p className="panel-note">Enter a date to see your week, milestones, and tips.</p>}
        </div>

        <div className="panel tip-panel">
          <div className="panel-head">
            <div>
              <h2>Weekly tip</h2>
              <p>Personalized guidance for your current week.</p>
            </div>
            <Sparkles size={20} />
          </div>
          {info ? (
            <>
              <button className="complete small" onClick={askTip} disabled={tipLoading}>
                <Sparkles size={15} /> {tipLoading ? 'Thinking…' : tip ? 'Regenerate tip' : 'Ask AI for this week'}
              </button>
              {tip && <div className="tip-box">{tip}</div>}
              {!tip && !tipLoading && (
                <p className="panel-note">
                  Uses the connected AI when available — falls back to curated
                  guidance offline.
                </p>
              )}
            </>
          ) : (
            <p className="panel-note">Set your dates to unlock this week's tip.</p>
          )}
          <div className="warn-box">
            <AlertTriangle size={16} />
            <div>
              <strong>Seek care right away if you notice:</strong>
              <ul>
                {pregnancyWarningSigns.slice(0, 4).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Weekly milestones</h2>
              <p>Where your baby is on the journey.</p>
            </div>
            <Baby size={20} />
          </div>
          <div className="timeline">
            {weekMilestones.map((m) => {
              const reached = m.week <= (info?.currentWeek || -1)
              const isCurrent = m.week === info?.currentWeek
              return (
                <div key={m.week} className={`timeline-item ${reached ? 'reached' : ''} ${isCurrent ? 'current' : ''}`}>
                  <div className="timeline-dot">{m.week}</div>
                  <div>
                    <h3>{m.title}</h3>
                    <p>{m.text}</p>
                  </div>
                </div>
              )
            })}
            {!info && <p className="panel-note">Set your dates above to see the journey.</p>}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Notes for my clinician</h2>
              <p>
                Saved to your private account{info ? ` — currently week ${info.currentWeek}` : ''}.
              </p>
            </div>
            <NotebookPen size={20} />
          </div>
          {!user && (
            <p className="panel-note">
              <button className="linklike" onClick={onRequireAuth}>
                Sign in
              </button>{' '}
              to save notes.
            </p>
          )}
          <form className="note-form" onSubmit={saveNote}>
            <textarea
              rows={3}
              placeholder="Symptoms, questions for your midwife, feelings…"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <button type="submit" className="complete small">
              Save note
            </button>
          </form>
          {noteMsg && <p className="notice">{noteMsg}</p>}
          {notes.length > 0 && (
            <ul className="note-list">
              {notes.map((n) => (
                <li key={n.id}>
                  <div>
                    <strong>Week {n.week} · {n.date}</strong>
                    <p>{n.notes}</p>
                  </div>
                  <button className="icon-btn danger" onClick={() => deleteNote(n.id)} title="Delete">
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="disclaimer small page-disclaimer">
        Pregnancy guidance is educational and never replaces antenatal care.
        Always follow your midwife or doctor's advice.
      </p>
    </section>
  )
}
