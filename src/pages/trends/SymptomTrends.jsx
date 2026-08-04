import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import {
  AlertTriangle,
  Calendar,
  LineChart as LineChartIcon,
  Search,
} from 'lucide-react'
import { db } from '../../firebase'
import {
  buildCalendarCells,
  buildSymptomTrends,
  dateRangeKeys,
  longestStreak,
} from '../../data/trends'

const RANGE_DAYS = 30
const RECENT_LIMIT = 200

function rangeStart(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - (days - 1))
  return d
}

export default function SymptomTrends({ user, onRequireAuth }) {
  const [assessments, setAssessments] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState('')
  const [range, setRange] = useState(RANGE_DAYS)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user) {
      setAssessments([])
      setLoaded(true)
      return
    }
    ;(async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, 'users', user.uid, 'assessments'),
            orderBy('createdAt', 'desc'),
            limit(RECENT_LIMIT),
          ),
        )
        setAssessments(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          })),
        )
      } catch (err) {
        console.warn('Could not load assessments:', err)
        setError('Your saved assessments could not be loaded.')
      } finally {
        setLoaded(true)
      }
    })()
  }, [user])

  const keys = useMemo(
    () => dateRangeKeys(rangeStart(range), new Date()),
    [range],
  )

  const trends = useMemo(
    () => buildSymptomTrends(assessments, rangeStart(range), new Date()),
    [assessments, range],
  )

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase()
    if (!t) return trends
    return trends.filter((tr) => tr.symptom.toLowerCase().includes(t))
  }, [trends, search])

  const totalReports = useMemo(
    () => trends.reduce((sum, t) => sum + t.count, 0),
    [trends],
  )

  const urgentCount = useMemo(
    () =>
      assessments.filter((a) => {
        if (!a.createdAt) return false
        const when = new Date(a.createdAt)
        return (
          when >= rangeStart(range) && /urgent/i.test(a.urgency || '')
        )
      }).length,
    [assessments, range],
  )

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <LineChartIcon size={14} /> TRENDS
          </p>
          <h1>See patterns in your symptoms.</h1>
          <p>
            Once you've saved a few symptom assessments, Vitalis shows you the
            frequency and 30-day pattern for each one.
          </p>
          <button className="complete" onClick={onRequireAuth}>
            Sign in to see your trends
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <LineChartIcon size={14} /> SYMPTOM TRENDS
        </p>
        <h1>See patterns in your symptoms.</h1>
        <p>
          The last {range} days of your saved assessments, grouped by symptom
          so you can spot what is persistent, what is improving, and what to
          raise at your next visit.
        </p>
      </div>

      <div className="trends-summary">
        <div className="vitals-stat">
          <span className="muted small">Symptom reports</span>
          <strong>{totalReports}</strong>
          <span className="muted small">in last {range} days</span>
        </div>
        <div className="vitals-stat">
          <span className="muted small">Distinct symptoms</span>
          <strong>{trends.length}</strong>
          <span className="muted small">tracked</span>
        </div>
        <div className="vitals-stat">
          <span className="muted small">Urgent assessments</span>
          <strong>
            <span className={urgentCount > 0 ? 'vitals-tag danger' : 'vitals-tag normal'}>
              {urgentCount}
            </span>
          </strong>
          <span className="muted small">flagged in red</span>
        </div>
      </div>

      <div className="trends-toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Search symptoms…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="chips">
          {[7, 14, 30, 90].map((d) => (
            <button
              key={d}
              className={range === d ? 'chip selected' : 'chip'}
              onClick={() => setRange(d)}
            >
              Last {d} days
            </button>
          ))}
        </div>
      </div>

      {error && <p className="notice">{error}</p>}

      {loaded && trends.length === 0 && (
        <p className="panel-note">
          You haven’t saved any symptom assessments in this range yet. Try
          the symptom guide on the home page first.
        </p>
      )}

      {loaded && trends.length > 0 && filtered.length === 0 && (
        <p className="panel-note">No symptoms match “{search}”.</p>
      )}

      <div className="trends-list">
        {filtered.map((t) => {
          const cells = buildCalendarCells(t, keys)
          const onDays = cells.reduce((a, b) => a + b, 0)
          const streak = longestStreak(t, keys)
          const isUrgent = t.urgentCount > 0
          return (
            <article
              key={t.symptom}
              className={`trend-row ${isUrgent ? 'urgent' : ''}`}
            >
              <div className="trend-row-head">
                <div>
                  <strong>
                    {isUrgent && (
                      <AlertTriangle size={14} className="trend-urgent-icon" />
                    )}
                    {t.symptom}
                  </strong>
                  <span className="muted small">
                    {t.count} report{t.count === 1 ? '' : 's'} on {onDays}{' '}
                    day{onDays === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="trend-row-stats">
                  {streak >= 3 && (
                    <span className="vitals-tag danger" title="Consecutive days">
                      {streak}-day streak
                    </span>
                  )}
                  {isUrgent && (
                    <span className="vitals-tag urgent">
                      {t.urgentCount} urgent
                    </span>
                  )}
                </div>
              </div>
              <div className="trend-calendar" role="img" aria-label={`Last ${range} days for ${t.symptom}`}>
                {cells.map((c, i) => (
                  <span
                    key={i}
                    className={c ? 'trend-cell on' : 'trend-cell off'}
                    title={`${keys[i]}${c ? ' — reported' : ''}`}
                  />
                ))}
              </div>
            </article>
          )
        })}
      </div>

      <p className="disclaimer small page-disclaimer">
        Trends are based only on the symptom assessments you have saved. They
        are for your own awareness and never replace advice from a clinician.
      </p>
    </section>
  )
}
