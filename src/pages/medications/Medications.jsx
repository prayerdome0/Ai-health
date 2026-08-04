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
  updateDoc,
  where,
  getDocs,
} from 'firebase/firestore'
import {
  CheckCircle2,
  Clock,
  Pill,
  Plus,
  Save,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import { db } from '../../firebase'
import { friendlyFirestoreError } from '../../firestoreErrors'
import {
  computeAdherence,
  FREQUENCIES,
  frequencyFor,
  TIMINGS,
  timingsForFrequency,
  todayString,
} from '../../data/medications'

const ADHERENCE_DAYS = 7

function fmtDate(d) {
  if (!d) return '—'
  const date = d.toDate ? d.toDate() : new Date(d)
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const emptyForm = () => ({
  name: '',
  dose: '',
  unit: 'mg',
  frequency: 'once-daily',
  notes: '',
})

export default function Medications({ user, onRequireAuth }) {
  const [meds, setMeds] = useState([])
  const [logs, setLogs] = useState([]) // takenLogs for the adherence window
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Subscribe to the user's medications list.
  useEffect(() => {
    if (!user) {
      setMeds([])
      return
    }
    const q = query(
      collection(db, 'users', user.uid, 'medications'),
      orderBy('createdAt', 'desc'),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          createdAt: d.data().createdAt?.toDate?.() || null,
        }))
        setMeds(docs)
      },
      (err) => {
        console.warn('Could not load medications:', err)
        setError(friendlyFirestoreError(err, 'load'))
      },
    )
    return unsub
  }, [user])

  // Load takenLogs for the last ADHERENCE_DAYS days.
  useEffect(() => {
    if (!user) {
      setLogs([])
      return
    }
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const since = new Date(today)
    since.setDate(since.getDate() - (ADHERENCE_DAYS - 1))
    const sinceStr = since.toISOString().slice(0, 10)

    const q = query(
      collection(db, 'users', user.uid, 'medicationLogs'),
      where('date', '>=', sinceStr),
    )
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(q)
        if (!alive) return
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.warn('Could not load medication logs:', err)
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  const adherence = useMemo(
    () => computeAdherence(meds, logs, ADHERENCE_DAYS),
    [meds, logs],
  )

  const today = todayString()
  const checklist = useMemo(
    () =>
      meds
        .filter((m) => m.status !== 'stopped')
        .map((m) => {
          const slots =
            m.frequency === 'as-needed'
              ? []
              : timingsForFrequency(m.frequency).map((t) => t.key)
          const items = slots.map((s) => {
            const log = logs.find(
              (l) => l.medId === m.id && l.slot === s && l.date === today,
            )
            return { slot: s, taken: !!(log && log.taken), log }
          })
          return { med: m, items, isPrn: m.frequency === 'as-needed' }
        }),
    [meds, logs, today],
  )

  const addMed = async (e) => {
    e.preventDefault()
    if (!user) {
      onRequireAuth()
      return
    }
    if (!form.name.trim()) {
      setError('Please enter a medication name.')
      return
    }
    if (!form.dose.trim()) {
      setError('Please enter a dose (for example 500 or 10).')
      return
    }
    try {
      await addDoc(collection(db, 'users', user.uid, 'medications'), {
        name: form.name.trim(),
        dose: form.dose.trim(),
        unit: form.unit || 'mg',
        frequency: form.frequency,
        notes: form.notes.trim(),
        status: 'active',
        createdAt: serverTimestamp(),
      })
      setShowForm(false)
      setForm(emptyForm())
      setError('')
      setSuccess('Medication added.')
      setTimeout(() => setSuccess(''), 2500)
    } catch (err) {
      console.error('Could not add medication:', err)
      setError(friendlyFirestoreError(err, 'save'))
    }
  }

  const removeMed = async (id) => {
    if (!confirm('Remove this medication and all of its logs?')) return
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'medications', id))
    } catch (err) {
      console.error('Could not remove medication:', err)
      setError(friendlyFirestoreError(err, 'delete'))
    }
  }

  const toggleStatus = async (med) => {
    try {
      const next = med.status === 'stopped' ? 'active' : 'stopped'
      await updateDoc(doc(db, 'users', user.uid, 'medications', med.id), {
        status: next,
      })
    } catch (err) {
      console.error('Could not update medication:', err)
      setError(friendlyFirestoreError(err, 'save'))
    }
  }

  /**
   * Toggle "taken" for a given (med, slot, today). PRN meds log on demand.
   */
  const markTaken = async (med, slot) => {
    if (!user) {
      onRequireAuth()
      return
    }
    const existing = logs.find(
      (l) => l.medId === med.id && l.slot === slot && l.date === today,
    )
    try {
      if (existing) {
        await updateDoc(
          doc(db, 'users', user.uid, 'medicationLogs', existing.id),
          {
            taken: !existing.taken,
            takenAt: !existing.taken ? serverTimestamp() : null,
          },
        )
      } else {
        await addDoc(collection(db, 'users', user.uid, 'medicationLogs'), {
          medId: med.id,
          medName: med.name,
          slot,
          date: today,
          taken: true,
          takenAt: serverTimestamp(),
        })
      }
    } catch (err) {
      console.error('Could not mark medication:', err)
      setError(friendlyFirestoreError(err, 'save'))
    }
  }

  const logPrn = async (med) => {
    if (!user) {
      onRequireAuth()
      return
    }
    try {
      await addDoc(collection(db, 'users', user.uid, 'medicationLogs'), {
        medId: med.id,
        medName: med.name,
        slot: 'prn',
        date: today,
        taken: true,
        takenAt: serverTimestamp(),
      })
    } catch (err) {
      console.error('Could not log PRN dose:', err)
      setError(friendlyFirestoreError(err, 'save'))
    }
  }

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <Pill size={14} /> MEDICATIONS
          </p>
          <h1>Stay on top of your meds.</h1>
          <p>
            Add the medicines you take, get a daily checklist, and see your
            7-day adherence at a glance.
          </p>
          <button className="complete" onClick={onRequireAuth}>
            Sign in to start tracking
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <Pill size={14} /> MEDICATIONS
        </p>
        <h1>Stay on top of your meds.</h1>
        <p>
          Add the medicines you take, check them off each day, and see your
          adherence at a glance.
        </p>
      </div>

      <div className="adherence-card">
        <div className="adherence-ring" aria-hidden="true">
          <svg viewBox="0 0 80 80" width="92" height="92">
            <circle cx="40" cy="40" r="34" fill="none" stroke="#e1eae6" strokeWidth="9" />
            <circle
              cx="40"
              cy="40"
              r="34"
              fill="none"
              stroke="#168070"
              strokeWidth="9"
              strokeDasharray={`${(2 * Math.PI * 34 * (adherence.percent || 0)) / 100} ${
                2 * Math.PI * 34
              }`}
              strokeDashoffset={2 * Math.PI * 34 * 0.25}
              transform="rotate(-90 40 40)"
              strokeLinecap="round"
            />
            <text
              x="40"
              y="46"
              textAnchor="middle"
              fontSize="18"
              fontWeight="700"
              fill="#193b36"
            >
              {adherence.percent == null ? '—' : `${adherence.percent}%`}
            </text>
          </svg>
        </div>
        <div className="adherence-info">
          <h2>{ADHERENCE_DAYS}-day adherence</h2>
          <p className="muted">
            {adherence.taken} of {adherence.scheduled} scheduled doses taken
            {adherence.scheduled === 0 && ' — add a medication to start tracking.'}
          </p>
          {adherence.perMed.length > 0 && (
            <ul className="adherence-list">
              {adherence.perMed.map((p) => (
                <li key={p.medId}>
                  <span>{p.name}</span>
                  <span className="muted small">
                    {p.taken}/{p.scheduled} · {p.percent == null ? 'PRN' : `${p.percent}%`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {!showForm && (
          <button className="complete small" onClick={() => setShowForm(true)}>
            <Plus size={15} /> Add medication
          </button>
        )}
      </div>

      {showForm && (
        <form className="med-form" onSubmit={addMed}>
          <div className="med-form-grid">
            <label className="auth-field">
              <span>Medication name</span>
              <input
                type="text"
                placeholder="e.g. Amlodipine"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </label>
            <label className="auth-field">
              <span>Dose</span>
              <div className="dose-row">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 500"
                  value={form.dose}
                  onChange={(e) => setForm({ ...form, dose: e.target.value })}
                  required
                />
                <select
                  value={form.unit}
                  onChange={(e) => setForm({ ...form, unit: e.target.value })}
                  aria-label="Unit"
                >
                  {['mg', 'mcg', 'g', 'mL', 'IU', 'tab', 'puff', 'unit'].map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="auth-field">
              <span>Frequency</span>
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="auth-field span-2">
              <span>Notes (optional)</span>
              <input
                type="text"
                placeholder="e.g. with food, avoid grapefruit…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </label>
          </div>
          {error && <p className="notice">{error}</p>}
          <div className="vital-form-actions">
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setShowForm(false)
                setError('')
                setForm(emptyForm())
              }}
            >
              <X size={14} /> Cancel
            </button>
            <button type="submit" className="complete small">
              <Save size={14} /> Save medication
            </button>
          </div>
        </form>
      )}

      {success && <p className="vitals-success"><CheckCircle2 size={14} /> {success}</p>}

      <div className="med-list">
        {checklist.length === 0 && !showForm && (
          <p className="panel-note">
            No medications yet. Add your first one to see a daily checklist here.
          </p>
        )}
        {checklist.map(({ med, items, isPrn }) => {
          const allTaken = items.length > 0 && items.every((i) => i.taken)
          const timing = frequencyFor(med.frequency)
          return (
            <article
              key={med.id}
              className={`med-card ${allTaken ? 'all-taken' : ''}`}
            >
              <div className="med-card-head">
                <div>
                  <h3>
                    {med.name} <span className="muted small">{med.dose} {med.unit}</span>
                  </h3>
                  <p className="muted small">
                    {timing.label}
                    {med.notes ? ` · ${med.notes}` : ''}
                  </p>
                </div>
                <div className="med-card-actions">
                  {isPrn ? (
                    <button
                      className="complete small"
                      onClick={() => logPrn(med)}
                      title="Log a dose"
                    >
                      <Pill size={14} /> Log dose
                    </button>
                  ) : null}
                  <button
                    className="ghost-btn"
                    onClick={() => toggleStatus(med)}
                    title={med.status === 'stopped' ? 'Mark active' : 'Stop'}
                  >
                    {med.status === 'stopped' ? 'Reactivate' : 'Stop'}
                  </button>
                  <button
                    className="icon-btn danger"
                    onClick={() => removeMed(med.id)}
                    title="Remove"
                    aria-label="Remove medication"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {!isPrn && (
                <div className="med-checklist">
                  {items.map(({ slot, taken }) => {
                    const t = TIMINGS.find((x) => x.key === slot)
                    return (
                      <button
                        key={slot}
                        className={taken ? 'med-slot taken' : 'med-slot'}
                        onClick={() => markTaken(med, slot)}
                        title={taken ? 'Click to undo' : 'Mark as taken'}
                      >
                        {taken ? <CheckCircle2 size={15} /> : <Clock size={15} />}
                        <span>{t?.label || slot}</span>
                        <small>{t?.time}</small>
                      </button>
                    )
                  })}
                </div>
              )}
            </article>
          )
        })}
      </div>

      <p className="disclaimer small page-disclaimer">
        This is a tracking tool, not a prescription service. Always follow the
        exact instructions on your prescription or from your clinician. If you
        miss a dose or feel unwell after taking a medicine, contact a clinician.
      </p>
    </section>
  )
}
