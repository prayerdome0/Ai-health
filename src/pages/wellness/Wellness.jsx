import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import {
  CheckCircle2,
  Droplet,
  Footprints,
  Moon,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { db } from '../../firebase'
import { friendlyFirestoreError } from '../../firestoreErrors'
import {
  buildDayMap,
  lastNDayKeys,
  STEPS_GOAL,
  summarizeDay,
  todayKey,
  WATER_GOAL_ML,
  weekSummary,
} from '../../data/wellness'

const DAYS = 7

function Bar({ pct, color = '#168070' }) {
  return (
    <div className="wellness-bar">
      <div
        className="wellness-bar-fill"
        style={{ width: `${Math.max(2, Math.min(100, pct))}%`, background: color }}
      />
    </div>
  )
}

function TinyBars({ values, color = '#168070', goal = null, max = null }) {
  const safeMax = max != null ? max : Math.max(goal || 0, ...values, 1)
  return (
    <div className="wellness-tiny-bars">
      {values.map((v, i) => (
        <div
          key={i}
          className={
            goal != null && v >= goal ? 'wellness-tiny-bar on-goal' : 'wellness-tiny-bar'
          }
          title={`${v}`}
        >
          <span
            style={{
              height: `${Math.max(3, (v / safeMax) * 100)}%`,
              background: color,
            }}
          />
        </div>
      ))}
    </div>
  )
}

export default function Wellness({ user, onRequireAuth }) {
  const [entries, setEntries] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [today, setToday] = useState({ waterMl: 0, steps: 0, sleepH: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!user) {
      setEntries([])
      setLoaded(true)
      return
    }
    // We only need the last 7 days; subscribing to the whole collection is
    // fine because users will rarely have more than a few months of records.
    const q = query(
      collection(db, 'users', user.uid, 'wellness'),
      orderBy('date', 'desc'),
    )
    const unsub = onSnapshot(
      q,
      (snap) => {
        setEntries(
          snap.docs.map((d) => ({ id: d.id, ...d.data() })),
        )
        setLoaded(true)
      },
      (err) => {
        console.warn('Could not load wellness log:', err)
        setError(friendlyFirestoreError(err, 'load'))
        setLoaded(true)
      },
    )
    return unsub
  }, [user])

  const dayMap = useMemo(() => buildDayMap(entries), [entries])
  const week = useMemo(() => weekSummary(entries, DAYS), [entries])

  // Prefill today's form from existing data.
  useEffect(() => {
    const d = summarizeDay(dayMap[todayKey()])
    setToday({
      waterMl: d.waterMl,
      steps: d.steps,
      sleepH: d.sleepH === 0 ? '' : d.sleepH,
    })
  }, [dayMap])

  const updateField = (field, value) => {
    setToday((t) => ({ ...t, [field]: value }))
  }

  const addWater = (delta) => {
    setToday((t) => ({ ...t, waterMl: Math.max(0, Number(t.waterMl || 0) + delta) }))
  }

  const save = async (e) => {
    e.preventDefault()
    if (!user) {
      onRequireAuth()
      return
    }
    const date = todayKey()
    const payload = {
      date,
      waterMl: Math.max(0, Number(today.waterMl) || 0),
      steps: Math.max(0, Number(today.steps) || 0),
      sleepH: today.sleepH === '' ? null : Number(today.sleepH) || 0,
      updatedAt: serverTimestamp(),
    }
    try {
      await setDoc(doc(db, 'users', user.uid, 'wellness', date), payload, {
        merge: true,
      })
      setError('')
      setSuccess(`Saved today's wellness.`)
      setTimeout(() => setSuccess(''), 2500)
    } catch (err) {
      console.error('Could not save wellness:', err)
      setError(friendlyFirestoreError(err, 'save'))
    }
  }

  const clearToday = async () => {
    if (!user) return
    if (!confirm('Clear all of today’s wellness entries?')) return
    try {
      await setDoc(
        doc(db, 'users', user.uid, 'wellness', todayKey()),
        { waterMl: 0, steps: 0, sleepH: null, updatedAt: serverTimestamp() },
        { merge: true },
      )
    } catch (err) {
      console.error('Could not clear today:', err)
      setError(friendlyFirestoreError(err, 'save'))
    }
  }

  const last7 = useMemo(() => lastNDayKeys(DAYS), [])
  const waterSeries = last7.map((k) => Number(dayMap[k]?.waterMl) || 0)
  const stepsSeries = last7.map((k) => Number(dayMap[k]?.steps) || 0)
  const sleepSeries = last7.map((k) => Number(dayMap[k]?.sleepH) || 0)

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <Droplet size={14} /> WELLNESS
          </p>
          <h1>Track your day in seconds.</h1>
          <p>
            Quick-log water, steps, and sleep. Daily micro-actions that add up
            to better awareness over time.
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
          <Droplet size={14} /> DAILY WELLNESS
        </p>
        <h1>Track your day in seconds.</h1>
        <p>
          Tap to add water, log your steps, and record last night's sleep.
          Trends are private to your account.
        </p>
      </div>

      <form className="wellness-form" onSubmit={save}>
        <div className="wellness-cards">
          {/* Water card */}
          <article className="wellness-card">
            <div className="wellness-card-head">
              <span className="wellness-icon water">
                <Droplet size={18} />
              </span>
              <div>
                <h3>Water</h3>
                <p className="muted small">goal: {WATER_GOAL_ML} mL / day</p>
              </div>
            </div>
            <div className="wellness-counter">
              <button
                type="button"
                className="wellness-step"
                onClick={() => addWater(-250)}
                aria-label="Remove 250 mL"
              >
                −
              </button>
              <strong>
                {Number(today.waterMl) || 0} <small>mL</small>
              </strong>
              <button
                type="button"
                className="wellness-step"
                onClick={() => addWater(250)}
                aria-label="Add 250 mL"
              >
                +
              </button>
            </div>
            <div className="wellness-quickrow">
              {[250, 500, 750].map((n) => (
                <button
                  type="button"
                  key={n}
                  className="ghost-btn"
                  onClick={() => addWater(n)}
                >
                  <Plus size={12} /> {n} mL
                </button>
              ))}
            </div>
            <Bar pct={Math.min(100, ((Number(today.waterMl) || 0) / WATER_GOAL_ML) * 100)} color="#3b9ad6" />
          </article>

          {/* Steps card */}
          <article className="wellness-card">
            <div className="wellness-card-head">
              <span className="wellness-icon steps">
                <Footprints size={18} />
              </span>
              <div>
                <h3>Steps</h3>
                <p className="muted small">goal: {STEPS_GOAL.toLocaleString()} / day</p>
              </div>
            </div>
            <label className="wellness-input-row">
              <input
                type="number"
                inputMode="numeric"
                step="100"
                min="0"
                placeholder="e.g. 6000"
                value={today.steps}
                onChange={(e) => updateField('steps', e.target.value)}
              />
              <span className="muted small">steps</span>
            </label>
            <Bar pct={Math.min(100, ((Number(today.steps) || 0) / STEPS_GOAL) * 100)} color="#1b8a99" />
          </article>

          {/* Sleep card */}
          <article className="wellness-card">
            <div className="wellness-card-head">
              <span className="wellness-icon sleep">
                <Moon size={18} />
              </span>
              <div>
                <h3>Sleep</h3>
                <p className="muted small">last night</p>
              </div>
            </div>
            <label className="wellness-input-row">
              <input
                type="number"
                inputMode="decimal"
                step="0.25"
                min="0"
                max="24"
                placeholder="e.g. 7.5"
                value={today.sleepH}
                onChange={(e) => updateField('sleepH', e.target.value)}
              />
              <span className="muted small">hours</span>
            </label>
            <p className="muted small">
              Average this week:{' '}
              {week.sleepAvg ? week.sleepAvg.toFixed(1) : '—'} h
            </p>
          </article>
        </div>

        {error && <p className="notice">{error}</p>}
        {success && (
          <p className="vitals-success">
            <CheckCircle2 size={14} /> {success}
          </p>
        )}

        <div className="vital-form-actions">
          <button type="button" className="ghost-btn" onClick={clearToday}>
            <Trash2 size={14} /> Clear today
          </button>
          <button type="submit" className="complete">
            <Save size={15} /> Save today
          </button>
        </div>
      </form>

      <div className="wellness-trends">
        <h2>Your last {DAYS} days</h2>
        <div className="wellness-trend-grid">
          <article className="wellness-trend-card">
            <h3>
              <Droplet size={14} /> Water
            </h3>
            <p className="muted small">
              {week.waterTotal.toLocaleString()} mL total ·{' '}
              {week.waterGoalPct}% of goal
            </p>
            <TinyBars
              values={waterSeries}
              goal={WATER_GOAL_ML}
              color="#3b9ad6"
            />
            <div className="wellness-day-labels">
              {last7.map((k) => (
                <span key={k}>{k.slice(8, 10)}</span>
              ))}
            </div>
          </article>

          <article className="wellness-trend-card">
            <h3>
              <Footprints size={14} /> Steps
            </h3>
            <p className="muted small">
              {week.stepsTotal.toLocaleString()} steps total ·{' '}
              {week.stepsGoalPct}% of goal
            </p>
            <TinyBars
              values={stepsSeries}
              goal={STEPS_GOAL}
              color="#1b8a99"
            />
            <div className="wellness-day-labels">
              {last7.map((k) => (
                <span key={k}>{k.slice(8, 10)}</span>
              ))}
            </div>
          </article>

          <article className="wellness-trend-card">
            <h3>
              <Moon size={14} /> Sleep
            </h3>
            <p className="muted small">
              {week.sleepAvg ? week.sleepAvg.toFixed(1) : '—'} h average ·{' '}
              {week.sleepGoalPct}% of goal
            </p>
            <TinyBars
              values={sleepSeries}
              goal={8}
              color="#6c5ce7"
            />
            <div className="wellness-day-labels">
              {last7.map((k) => (
                <span key={k}>{k.slice(8, 10)}</span>
              ))}
            </div>
          </article>
        </div>
      </div>

      <p className="disclaimer small page-disclaimer">
        These are daily awareness tools. Goals here are general adult
        guidelines — your personal targets may differ. Follow your
        clinician's guidance for anything medical.
      </p>
    </section>
  )
}
