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
import {
  Activity,
  Calendar,
  CheckCircle2,
  Droplet,
  HeartPulse,
  LineChart as LineChartIcon,
  Moon,
  Plus,
  Save,
  Scale,
  Thermometer,
  Trash2,
  Wind,
  X,
} from 'lucide-react'
import { db } from '../../firebase'
import { CATEGORY_LABELS, getVital, VITAL_TYPES } from '../../data/vitals'

const HISTORY_LIMIT = 200
const RANGE_DAYS = 30

const ICONS = {
  Activity,
  Droplet,
  HeartPulse,
  Scale,
  Thermometer,
  Wind,
  Moon,
}

/** A tiny inline SVG line chart so we don't pull in a chart library. */
function SparkLine({ points, color = '#168070', height = 60, dangerZones = [] }) {
  if (!points || points.length === 0) {
    return (
      <div className="spark-empty" style={{ height }}>
        No readings yet
      </div>
    )
  }
  const padding = 8
  const w = 280
  const h = height
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys, ...dangerZones.map((z) => z.to))
  const maxY = Math.max(...ys, ...dangerZones.map((z) => z.from))
  const rangeX = Math.max(1, maxX - minX)
  const rangeY = Math.max(1, maxY - minY)
  const px = (x) => padding + ((x - minX) / rangeX) * (w - padding * 2)
  const py = (y) => h - padding - ((y - minY) / rangeY) * (h - padding * 2)
  const path = points
    .map((p, i) => (i === 0 ? `M ${px(p.x)} ${py(p.y)}` : `L ${px(p.x)} ${py(p.y)}`))
    .join(' ')
  const last = points[points.length - 1]
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      preserveAspectRatio="none"
      className="spark-svg"
    >
      {/* danger-zone band, if provided */}
      {dangerZones.length > 0 &&
        dangerZones.map((z, i) => {
          const y1 = py(Math.max(z.from, minY))
          const y2 = py(Math.min(z.to, maxY))
          return (
            <rect
              key={i}
              x={0}
              y={y2}
              width={w}
              height={Math.max(0, y1 - y2)}
              fill="#b8540e22"
            />
          )
        })}
      <path d={path} fill="none" stroke={color} strokeWidth="2" />
      {points.length > 1 && (
        <circle cx={px(last.x)} cy={py(last.y)} r="3.5" fill={color} />
      )}
    </svg>
  )
}

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

function trendDelta(items) {
  if (items.length < 2) return null
  const newest = items[0]
  const oldest = items[items.length - 1]
  const a = primaryValue(newest)
  const b = primaryValue(oldest)
  if (a == null || b == null) return null
  return { delta: a - b, newest: a, oldest: b }
}

function primaryValue(item) {
  if (item.systolic != null) return Number(item.systolic)
  if (item.value != null) return Number(item.value)
  return null
}

export default function VitalsTracker({ user, onRequireAuth }) {
  const [active, setActive] = useState('bp') // selected vital type
  const [form, setForm] = useState({}) // current entry form
  const [showForm, setShowForm] = useState(false)
  const [entries, setEntries] = useState([]) // current type's recent entries
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Subscribe to the current type's entries from Firestore.
  useEffect(() => {
    if (!user) {
      setEntries([])
      return
    }
    const q = query(
      collection(db, 'users', user.uid, 'vitals', active, 'entries'),
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
        setEntries(docs)
        setError('')
      },
      (err) => {
        console.warn('Could not load vitals:', err)
        setError('Some readings could not be loaded.')
      },
    )
    return unsub
  }, [user, active])

  const vital = getVital(active)

  // Reset form when switching vitals.
  useEffect(() => {
    if (!vital) return
    const empty = { notes: '' }
    for (const f of vital.fields) empty[f.name] = ''
    setForm(empty)
  }, [active]) // eslint-disable-line react-hooks/exhaustive-deps

  const recent = useMemo(() => {
    const cutoff = Date.now() - RANGE_DAYS * 24 * 60 * 60 * 1000
    return entries
      .filter((e) => {
        if (!e.createdAt) return false
        const t = e.createdAt.getTime ? e.createdAt.getTime() : new Date(e.createdAt).getTime()
        return t >= cutoff
      })
      .sort((a, b) => {
        const ta = a.createdAt.getTime ? a.createdAt.getTime() : 0
        const tb = b.createdAt.getTime ? b.createdAt.getTime() : 0
        return ta - tb
      })
  }, [entries])

  const sparkPoints = recent.map((e) => ({
    x: e.createdAt ? e.createdAt.getTime() : 0,
    y: primaryValue(e) ?? 0,
  }))

  const dangerZones = useMemo(() => {
    if (!vital) return []
    const cat = vital.category
    if (!cat) return []
    // Build a danger band from sample values across the Y range.
    const probe = {}
    for (const f of vital.fields) probe[f.name] = '100'
    if (vital.hasTwo) {
      probe.systolic = '180'
      probe.diastolic = '120'
    } else {
      probe.value = vital.key === 'sleep' ? '5' : '40'
    }
    const c = cat(probe)
    if (c === 'danger') return [{ from: 0, to: 9999 }]
    return []
  }, [vital])

  const trend = useMemo(() => trendDelta(recent), [recent])

  const submit = async (e) => {
    e.preventDefault()
    if (!user) {
      onRequireAuth()
      return
    }
    if (!vital) return
    // Validate: require at least one numeric field
    const payload = { notes: form.notes || '' }
    let hasAny = false
    for (const f of vital.fields) {
      const v = (form[f.name] ?? '').toString().trim()
      if (v === '') {
        setError(`Please fill in ${f.label}.`)
        return
      }
      const n = Number(v)
      if (!Number.isFinite(n)) {
        setError(`${f.label} must be a number.`)
        return
      }
      payload[f.name] = n
      hasAny = true
    }
    if (!hasAny) return
    try {
      await addDoc(collection(db, 'users', user.uid, 'vitals', active, 'entries'), {
        ...payload,
        category: vital.category(payload),
        createdAt: serverTimestamp(),
      })
      setShowForm(false)
      setError('')
      setSuccess(`Saved your ${vital.short} reading.`)
      setTimeout(() => setSuccess(''), 2500)
      // Reset the form
      const empty = { notes: '' }
      for (const f of vital.fields) empty[f.name] = ''
      setForm(empty)
    } catch (err) {
      console.error('Could not save vital reading:', err)
      setError('We could not save this right now. Please try again.')
    }
  }

  const remove = async (id) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'vitals', active, 'entries', id))
    } catch (err) {
      console.error('Could not delete reading:', err)
    }
  }

  // Not signed in
  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <Activity size={14} /> VITALS
          </p>
          <h1>Track what matters, daily.</h1>
          <p>
            Log blood pressure, heart rate, glucose, weight, temperature, oxygen
            and sleep. Trends are private to your account.
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
          <Activity size={14} /> VITALS TRACKER
        </p>
        <h1>Track what matters, daily.</h1>
        <p>
          Pick a vital to log a new reading, see your trend over the last
          {RANGE_DAYS} days, and keep your history private.
        </p>
      </div>

      <div className="vital-tabs">
        {VITAL_TYPES.map((v) => {
          const Icon = ICONS[v.icon] || Activity
          return (
            <button
              key={v.key}
              className={active === v.key ? 'vital-tab selected' : 'vital-tab'}
              onClick={() => {
                setActive(v.key)
                setShowForm(false)
                setError('')
                setSuccess('')
              }}
            >
              <Icon size={15} /> {v.label}
            </button>
          )
        })}
      </div>

      <div className="vitals-grid">
        <div className="vitals-card">
          <div className="vitals-card-head">
            <div>
              <h2>{vital.label}</h2>
              <p className="muted small">
                {vital.hasTwo
                  ? `${vital.unit} · two numbers per reading`
                  : `${vital.unit}`}
              </p>
            </div>
            {!showForm && (
              <button
                className="complete small"
                onClick={() => {
                  setShowForm(true)
                  setError('')
                  setSuccess('')
                }}
              >
                <Plus size={15} /> Add reading
              </button>
            )}
          </div>

          {showForm && (
            <form className="vital-form" onSubmit={submit}>
              <div className={vital.hasTwo ? 'vital-row two' : 'vital-row'}>
                {vital.fields.map((f) => (
                  <label key={f.name} className="auth-field">
                    <span>{f.label}</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step={f.step}
                      placeholder={f.placeholder}
                      value={form[f.name] ?? ''}
                      onChange={(e) =>
                        setForm({ ...form, [f.name]: e.target.value })
                      }
                      required
                    />
                  </label>
                ))}
              </div>
              <label className="auth-field">
                <span>Notes (optional)</span>
                <input
                  type="text"
                  placeholder="e.g. before dinner, after a walk…"
                  value={form.notes ?? ''}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </label>
              {error && <p className="notice">{error}</p>}
              {vital.notes && <p className="muted small">{vital.notes}</p>}
              <div className="vital-form-actions">
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setShowForm(false)
                    setError('')
                  }}
                >
                  <X size={14} /> Cancel
                </button>
                <button type="submit" className="complete small">
                  <Save size={14} /> Save reading
                </button>
              </div>
            </form>
          )}

          {!showForm && (
            <>
              <div className="vitals-summary">
                <div className="vitals-stat">
                  <span className="muted small">Latest</span>
                  <strong>
                    {entries[0] ? vital.summary(entries[0]) : '—'}
                  </strong>
                  {entries[0] && (
                    <span
                      className={`vitals-tag ${entries[0].category || 'normal'}`}
                    >
                      {CATEGORY_LABELS[entries[0].category] || '—'}
                    </span>
                  )}
                </div>
                <div className="vitals-stat">
                  <span className="muted small">In last {RANGE_DAYS} days</span>
                  <strong>{recent.length}</strong>
                  <span className="muted small">readings</span>
                </div>
                <div className="vitals-stat">
                  <span className="muted small">Trend</span>
                  {trend ? (
                    <strong>
                      {trend.delta > 0 ? '+' : ''}
                      {trend.delta.toFixed(
                        vital.key === 'weight' ||
                          vital.key === 'temperature' ||
                          vital.key === 'sleep'
                          ? 1
                          : 0,
                      )}
                    </strong>
                  ) : (
                    <strong>—</strong>
                  )}
                  <span className="muted small">vs oldest in window</span>
                </div>
              </div>
              {success && (
                <p className="vitals-success">
                  <CheckCircle2 size={14} /> {success}
                </p>
              )}
              <div className="vitals-chart-wrap">
                <div className="vitals-chart-head">
                  <span className="overline">
                    <LineChartIcon size={13} /> {RANGE_DAYS}-DAY TREND
                  </span>
                  <span className="muted small">
                    range: {vital.range.normal}
                  </span>
                </div>
                <SparkLine
                  points={sparkPoints}
                  dangerZones={dangerZones}
                  color="#168070"
                />
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>History</h2>
              <p>
                {entries.length} reading{entries.length === 1 ? '' : 's'} for{' '}
                {vital.short}
              </p>
            </div>
            <Calendar size={20} />
          </div>
          {entries.length === 0 && (
            <p className="panel-note">No readings yet — add your first one.</p>
          )}
          <ul className="vitals-history">
            {entries.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{vital.summary(e)}</strong>
                  <span className="muted small">
                    {fmtDate(e.createdAt)}
                    {e.notes ? ` · ${e.notes}` : ''}
                  </span>
                </div>
                <div className="vitals-history-right">
                  <span className={`vitals-tag ${e.category || 'normal'}`}>
                    {CATEGORY_LABELS[e.category] || '—'}
                  </span>
                  <button
                    className="icon-btn danger"
                    onClick={() => remove(e.id)}
                    title="Delete"
                    aria-label="Delete reading"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p className="disclaimer small page-disclaimer">
        Ranges shown here are general wellness reference points for adults. They
        are not medical advice. Your personal targets may be different — please
        follow your clinician's guidance.
      </p>
    </section>
  )
}
