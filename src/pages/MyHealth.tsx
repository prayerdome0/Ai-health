import { useEffect, useState } from 'react'
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore'
import {
  Activity,
  CalendarCheck,
  ClipboardList,
  FileHeart,
  NotebookPen,
  Phone,
  Trash2,
} from 'lucide-react'
import { db } from '../firebase'
import { friendlyFirestoreError } from '../firestoreErrors'

const TABS = [
  { key: 'assessments', label: 'Assessments', icon: ClipboardList },
  { key: 'checkIns', label: 'Check-ins', icon: Activity },
  { key: 'appointments', label: 'Appointments', icon: CalendarCheck },
  { key: 'pregnancyNotes', label: 'Pregnancy notes', icon: NotebookPen },
  { key: 'emergencyContacts', label: 'Contacts', icon: Phone },
]

function fmtDate(d) {
  if (!d) return '—'
  const date = d.toDate ? d.toDate() : new Date(d)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function MyHealth({ user, onRequireAuth }) {
  const [tab, setTab] = useState('assessments')
  const [data, setData] = useState({})
  const [error, setError] = useState('')

  useEffect(() => {
    setError('')
    if (!user) {
      setData({})
      return
    }
    const unsubs = TABS.map(({ key }) => {
      const q = query(collection(db, 'users', user.uid, key), orderBy('createdAt', 'desc'))
      return onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }))
          setData((prev) => ({ ...prev, [key]: items }))
        },
        (err) => {
          console.warn(`Could not load ${key}:`, err)
          setError(friendlyFirestoreError(err, 'load'))
        }
      )
    })
    return () => unsubs.forEach((u) => u())
  }, [user])

  const remove = async (key, id) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, key, id))
    } catch (err) {
      console.error('Could not delete record:', err)
      setError(friendlyFirestoreError(err, 'delete'))
    }
  }

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <FileHeart size={14} /> MY HEALTH
          </p>
          <h1>Your records, in one place.</h1>
          <p>
            Everything you save — assessments, check-ins, appointments, notes —
            lives in your private account.
          </p>
          <button className="complete" onClick={onRequireAuth}>
            Sign in to view
          </button>
        </div>
      </section>
    )
  }

  const items = data[tab] || []

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <FileHeart size={14} /> MY HEALTH
        </p>
        <h1>Your records.</h1>
        <p>Private to your account — only you (and platform admins) can read them.</p>
      </div>

      <div className="tabs">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} className={tab === key ? 'tab selected' : 'tab'} onClick={() => setTab(key)}>
            <Icon size={15} /> {label}
            <span className="tab-count">{data[key]?.length || 0}</span>
          </button>
        ))}
      </div>

      {error && <p className="notice">{error}</p>}

      {items.length === 0 && <p className="panel-note">Nothing saved here yet.</p>}

      <div className="record-list">
        {items.map((item) => (
          <article className="record" key={item.id}>
            <div className="record-main">
              {tab === 'assessments' && (
                <>
                  <strong>{item.urgency || 'Assessment'}</strong>
                  <p>{(item.symptoms || []).join(', ') || '—'}</p>
                  {item.note && <p className="record-note">“{item.note}”</p>}
                </>
              )}
              {tab === 'checkIns' && (
                <>
                  <strong>Daily check-in</strong>
                  <p>{(item.answers || []).join(' · ') || '—'}</p>
                </>
              )}
              {tab === 'appointments' && (
                <>
                  <strong>
                    {item.doctorName} — {item.status}
                  </strong>
                  <p>
                    {item.date} at {item.time} · {item.specialty}
                  </p>
                  {item.reason && <p className="record-note">“{item.reason}”</p>}
                </>
              )}
              {tab === 'pregnancyNotes' && (
                <>
                  <strong>Week {item.week} · {item.date}</strong>
                  <p>{item.notes}</p>
                </>
              )}
              {tab === 'emergencyContacts' && (
                <>
                  <strong>{item.name}</strong>
                  <p>
                    {item.phone} {item.relation ? `· ${item.relation}` : ''}
                  </p>
                </>
              )}
            </div>
            <div className="record-side">
              <span className="record-date">{fmtDate(item.createdAt)}</span>
              <button className="icon-btn danger" onClick={() => remove(tab, item.id)} title="Delete">
                <Trash2 size={15} />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
