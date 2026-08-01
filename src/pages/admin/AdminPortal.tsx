import { useEffect, useState } from 'react'
import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  query,
} from 'firebase/firestore'
import {
  Activity,
  Bot,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from 'lucide-react'
import { db } from '../../firebase'
import { getAIStatus } from '../../ai'

const COLLECTIONS = ['assessments', 'checkIns', 'appointments', 'emergencyContacts', 'pregnancyNotes']

export default function AdminPortal({ user }) {
  const [role, setRole] = useState(null) // null = checking, 'admin' | 'user'
  const [stats, setStats] = useState(null)
  const [recent, setRecent] = useState([])
  const [aiStatus, setAiStatus] = useState({ available: false, model: null })
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!user) {
        setRole('user')
        return
      }
      try {
        const token = await user.getIdTokenResult()
        const isAdmin = token.claims?.role === 'Admin'
        if (!alive) return
        setRole(isAdmin ? 'admin' : 'user')
        if (!isAdmin) return
      } catch (err) {
        console.warn('Could not verify admin role:', err)
        if (alive) setRole('user')
        return
      }

      // Gather platform stats (rules give Admins full read access)
      try {
        const usersSnap = await getDocs(query(collection(db, 'users'), limit(100)))
        const users = usersSnap.docs
        const perCollection = {}
        for (const c of COLLECTIONS) perCollection[c] = 0

        for (const u of users) {
          for (const c of COLLECTIONS) {
            try {
              const count = await getCountFromServer(collection(db, 'users', u.id, c))
              perCollection[c] += count.data().count
            } catch {
              /* collection may not exist */
            }
          }
        }

        // Recent entries: latest assessment + check-in per user (cap reads)
        const recentEntries = []
        for (const u of users.slice(0, 20)) {
          for (const c of ['assessments', 'checkIns']) {
            try {
              const snap = await getDocs(query(collection(db, 'users', u.id, c), limit(2)))
              snap.docs.forEach((d) => {
                const data = d.data()
                recentEntries.push({
                  id: `${u.id}-${d.id}`,
                  userName: u.data()?.fullName || u.id.slice(0, 6),
                  type: c === 'assessments' ? 'Assessment' : 'Check-in',
                  summary:
                    c === 'assessments'
                      ? (data.symptoms || []).join(', ') || data.urgency || '—'
                      : (data.answers || []).filter(Boolean).join(' · ') || '—',
                  date: data.createdAt?.toDate?.() || null,
                })
              })
            } catch {
              /* skip */
            }
          }
        }
        recentEntries.sort((a, b) => (b.date || 0) - (a.date || 0))
        if (alive) {
          setStats({ users: users.length, ...perCollection })
          setRecent(recentEntries.slice(0, 10))
        }
      } catch (err) {
        console.error('Could not load platform stats:', err)
        if (alive) setError('Could not load platform statistics. Check the Firestore rules and try again.')
      }
    })()

    getAIStatus().then((s) => alive && setAiStatus(s))
    return () => {
      alive = false
    }
  }, [user])

  if (role === null) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <ShieldCheck size={14} /> ADMIN
          </p>
          <h1>Checking access…</h1>
        </div>
      </section>
    )
  }

  if (role === 'user') {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <ShieldAlert size={14} /> ADMIN
          </p>
          <h1>Admin access required.</h1>
          <p>
            This area is restricted to platform administrators. If you are an
            owner, set the <code>role: Admin</code> custom claim on your Firebase
            Auth user (Firebase console → Authentication → Users → “Set custom
            claims”) and sign in again.
          </p>
        </div>
      </section>
    )
  }

  const cards = [
    { label: 'Users', value: stats?.users ?? '—', icon: Users },
    { label: 'Assessments', value: stats?.assessments ?? '—', icon: ClipboardList },
    { label: 'Check-ins', value: stats?.checkIns ?? '—', icon: Activity },
    { label: 'Appointments', value: stats?.appointments ?? '—', icon: HeartPulse },
    { label: 'Emergency contacts', value: stats?.emergencyContacts ?? '—', icon: ShieldCheck },
    { label: 'Pregnancy notes', value: stats?.pregnancyNotes ?? '—', icon: HeartPulse },
  ]

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <ShieldCheck size={14} /> ADMIN PORTAL
        </p>
        <h1>Platform overview.</h1>
        <p>Live counts across all users' private data. Only admins can see this.</p>
      </div>

      {error && <p className="notice">{error}</p>}

      <div className="stat-grid">
        {cards.map((c) => (
          <article className="stat-card" key={c.label}>
            <c.icon size={18} />
            <strong>{c.value}</strong>
            <span>{c.label}</span>
          </article>
        ))}
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Recent activity</h2>
              <p>Latest assessments and check-ins across the platform.</p>
            </div>
            <Activity size={20} />
          </div>
          {recent.length === 0 && <p className="panel-note">No activity yet.</p>}
          <ul className="appointment-list">
            {recent.map((r) => (
              <li key={r.id}>
                <div className="appt-date">
                  <strong>{r.date ? r.date.toLocaleDateString() : '—'}</strong>
                  <span>{r.type}</span>
                </div>
                <div className="appt-info">
                  <strong>{r.userName}</strong>
                  <span className="appt-reason">{r.summary}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>AI status</h2>
              <p>Whether the AI assistant is connected.</p>
            </div>
            <Bot size={20} />
          </div>
          <div className={`ai-status ${aiStatus.available ? 'ok' : 'off'}`}>
            {aiStatus.available ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
            <div>
              <strong>{aiStatus.available ? 'AI assistant online' : 'AI assistant not configured'}</strong>
              <p>
                {aiStatus.available
                  ? `Model: ${aiStatus.model}`
                  : 'Add AI_API_KEY in Vercel → Settings → Environment Variables to enable it.'}
              </p>
            </div>
          </div>
          <div className="panel-note" style={{ marginTop: 14 }}>
            Tip: set <code>role: Admin</code> as a custom claim on any user to
            grant them access to this portal and to maintain the doctor
            directory.
          </div>
        </div>
      </div>
    </section>
  )
}
