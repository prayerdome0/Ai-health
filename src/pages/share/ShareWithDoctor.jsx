import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import {
  ClipboardList,
  FileHeart,
  FileText,
  Pill,
  Printer,
  Stethoscope,
} from 'lucide-react'
import { db } from '../../firebase'
import { CATEGORY_LABELS, getVital, VITAL_TYPES } from '../../data/vitals'
import { computeAdherence, frequencyFor, timingsForFrequency } from '../../data/medications'

/**
 * Build a single, print-friendly summary of the user's recent health data so
 * they can show it to a clinician. The page itself is print-styled (see
 * .share-page CSS) and the "Print" button calls window.print().
 */
const RECENT_COUNT = 5
const RANGE_DAYS = 30

function fmtDate(d) {
  if (!d) return '—'
  const date = d.toDate ? d.toDate() : new Date(d)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function shortDate(d) {
  if (!d) return '—'
  const date = d.toDate ? d.toDate() : new Date(d)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function primaryValue(item, vital) {
  if (vital.hasTwo) return item.systolic != null ? `${item.systolic}/${item.diastolic}` : null
  if (item.value != null) return `${item.value} ${vital.unit}`
  return null
}

export default function ShareWithDoctor({ user, onRequireAuth }) {
  const [data, setData] = useState({
    assessments: [],
    checkIns: [],
    pregnancyNotes: [],
    emergencyContacts: [],
    vitals: {}, // by type key
    medications: [],
    medicationLogs: [],
  })
  const [loaded, setLoaded] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!user) return
    let alive = true
    ;(async () => {
      try {
        const today = new Date()
        const since = new Date(today)
        since.setDate(since.getDate() - RANGE_DAYS)
        const sinceTs = since.toISOString().slice(0, 10)

        const [
          assessments,
          checkIns,
          pregnancyNotes,
          emergencyContacts,
          medications,
          medicationLogs,
        ] = await Promise.all([
          getDocs(
            query(
              collection(db, 'users', user.uid, 'assessments'),
              orderBy('createdAt', 'desc'),
              limit(RECENT_COUNT),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', user.uid, 'checkIns'),
              orderBy('createdAt', 'desc'),
              limit(RECENT_COUNT),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', user.uid, 'pregnancyNotes'),
              orderBy('createdAt', 'desc'),
              limit(RECENT_COUNT),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', user.uid, 'emergencyContacts'),
              orderBy('createdAt', 'desc'),
              limit(RECENT_COUNT),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', user.uid, 'medications'),
              orderBy('createdAt', 'desc'),
            ),
          ),
          getDocs(
            query(
              collection(db, 'users', user.uid, 'medicationLogs'),
              orderBy('date', 'desc'),
              limit(500),
            ),
          ),
        ])

        const vitals = {}
        for (const v of VITAL_TYPES) {
          const snap = await getDocs(
            query(
              collection(db, 'users', user.uid, 'vitals', v.key, 'entries'),
              orderBy('createdAt', 'desc'),
              limit(5),
            ),
          )
          vitals[v.key] = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }))
        }

        if (!alive) return
        setData({
          assessments: assessments.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          })),
          checkIns: checkIns.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          })),
          pregnancyNotes: pregnancyNotes.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          })),
          emergencyContacts: emergencyContacts.docs.map((d) => ({
            id: d.id,
            ...d.data(),
          })),
          vitals,
          medications: medications.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          })),
          medicationLogs: medicationLogs.docs.map((d) => ({ id: d.id, ...d.data() })),
        })
      } catch (err) {
        console.warn('Could not load summary data:', err)
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [user])

  const adherence = useMemo(
    () => computeAdherence(data.medications, data.medicationLogs, 7),
    [data.medications, data.medicationLogs],
  )

  const generatedAt = useMemo(() => new Date(), []) // freeze at mount

  const print = () => {
    setGenerating(true)
    // Give the browser a tick to commit any pending layout, then open the print dialog.
    setTimeout(() => {
      try {
        window.print()
      } finally {
        setTimeout(() => setGenerating(false), 800)
      }
    }, 60)
  }

  const copySummary = async () => {
    const text = buildTextSummary({ data, adherence, user, generatedAt })
    try {
      await navigator.clipboard.writeText(text)
      alert('Summary copied to clipboard. Paste it into an email or message.')
    } catch {
      alert('Could not copy automatically. Use Print → Save as PDF instead.')
    }
  }

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <FileText size={14} /> SHARE WITH DOCTOR
          </p>
          <h1>Bring your data to your visit.</h1>
          <p>
            Generate a one-page summary of your recent assessments, vitals,
            medications and notes. Print it, save as PDF, or copy the text.
          </p>
          <button className="complete" onClick={onRequireAuth}>
            Sign in to build a summary
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page share-page">
      <div className="page-head no-print">
        <p className="overline">
          <FileText size={14} /> SHARE WITH DOCTOR
        </p>
        <h1>Bring your data to your visit.</h1>
        <p>
          A one-page summary of your recent assessments, vitals, medications
          and notes — print it, save as PDF, or copy the text below.
        </p>
        <div className="share-actions">
          <button className="complete" onClick={print} disabled={generating || !loaded}>
            <Printer size={16} /> {generating ? 'Opening print…' : 'Print / Save as PDF'}
          </button>
          <button className="ghost-btn" onClick={copySummary}>
            <FileText size={15} /> Copy as text
          </button>
        </div>
      </div>

      {/* The printable summary itself */}
      <article className="share-doc" id="share-doc">
        <header className="share-doc-head">
          <div>
            <h2>Vitalis health summary</h2>
            <p className="muted small">
              For {user.displayName || user.email || 'patient'} · generated{' '}
              {generatedAt.toLocaleString()}
            </p>
            <p className="muted small">
              Wellness guidance tool, not a medical record. Please verify all
              values with your clinician.
            </p>
          </div>
        </header>

        <SummarySection icon={<Pill size={16} />} title="Active medications">
          {data.medications.length === 0 ? (
            <p className="muted small">No medications on file.</p>
          ) : (
            <>
              <table className="share-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Dose</th>
                    <th>Frequency</th>
                    <th>Status</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {data.medications.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <strong>{m.name}</strong>
                        {m.notes && <div className="muted small">{m.notes}</div>}
                      </td>
                      <td>
                        {m.dose} {m.unit}
                      </td>
                      <td>{frequencyFor(m.frequency).label}</td>
                      <td>{m.status || 'active'}</td>
                      <td>{shortDate(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {adherence.scheduled > 0 && (
                <p className="muted small share-adherence">
                  7-day adherence: {adherence.taken}/{adherence.scheduled} doses
                  taken ({adherence.percent}%).
                </p>
              )}
            </>
          )}
        </SummarySection>

        <SummarySection
          icon={<Stethoscope size={16} />}
          title="Recent vitals (last 5 readings per type)"
        >
          {VITAL_TYPES.every((v) => (data.vitals[v.key] || []).length === 0) ? (
            <p className="muted small">No vitals logged yet.</p>
          ) : (
            <div className="vitals-print-grid">
              {VITAL_TYPES.map((v) => {
                const items = data.vitals[v.key] || []
                if (items.length === 0) return null
                return (
                  <div key={v.key} className="vitals-print-block">
                    <strong>{v.label}</strong>
                    <ul>
                      {items.map((it) => (
                        <li key={it.id}>
                          <span>{primaryValue(it, v)}</span>
                          <span className="muted small">{shortDate(it.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </SummarySection>

        <SummarySection
          icon={<ClipboardList size={16} />}
          title="Recent symptom assessments"
        >
          {data.assessments.length === 0 ? (
            <p className="muted small">No recent assessments.</p>
          ) : (
            <ul className="share-list">
              {data.assessments.map((a) => (
                <li key={a.id}>
                  <div>
                    <strong>
                      {a.urgency || 'Assessment'} · {fmtDate(a.createdAt)}
                    </strong>
                    <div className="muted small">
                      Symptoms: {(a.symptoms || []).join(', ') || '—'}
                    </div>
                    {a.note && (
                      <div className="muted small">“{a.note}”</div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SummarySection>

        <SummarySection icon={<FileHeart size={16} />} title="Recent check-ins">
          {data.checkIns.length === 0 ? (
            <p className="muted small">No recent check-ins.</p>
          ) : (
            <ul className="share-list">
              {data.checkIns.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{fmtDate(c.createdAt)}</strong>
                    <div className="muted small">
                      {(c.answers || []).join(' · ') || '—'}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SummarySection>

        {data.pregnancyNotes.length > 0 && (
          <SummarySection
            icon={<FileHeart size={16} />}
            title="Pregnancy notes"
          >
            <ul className="share-list">
              {data.pregnancyNotes.map((n) => (
                <li key={n.id}>
                  <div>
                    <strong>
                      Week {n.week} · {n.date}
                    </strong>
                    <div>{n.notes}</div>
                  </div>
                </li>
              ))}
            </ul>
          </SummarySection>
        )}

        {data.emergencyContacts.length > 0 && (
          <SummarySection icon={<FileHeart size={16} />} title="Emergency contacts">
            <ul className="share-list">
              {data.emergencyContacts.map((c) => (
                <li key={c.id}>
                  <strong>
                    {c.name} · {c.phone}
                  </strong>
                  {c.relation && (
                    <span className="muted small"> · {c.relation}</span>
                  )}
                </li>
              ))}
            </ul>
          </SummarySection>
        )}

        <footer className="share-doc-foot">
          <p className="muted small">
            Generated by Vitalis. This summary is built from your private
            account data and is not stored on any server after you leave this
            page.
          </p>
        </footer>
      </article>
    </section>
  )
}

function SummarySection({ icon, title, children }) {
  return (
    <section className="share-section">
      <h3>
        {icon} {title}
      </h3>
      {children}
    </section>
  )
}

function buildTextSummary({ data, adherence, user, generatedAt }) {
  const lines = []
  lines.push('VITALIS HEALTH SUMMARY')
  lines.push(`For: ${user?.displayName || user?.email || 'patient'}`)
  lines.push(`Generated: ${generatedAt.toLocaleString()}`)
  lines.push('---')
  lines.push('MEDICATIONS:')
  if (data.medications.length === 0) lines.push('  (none)')
  for (const m of data.medications) {
    lines.push(
      `  - ${m.name} ${m.dose}${m.unit}, ${frequencyFor(m.frequency).label}${m.notes ? ` (${m.notes})` : ''}`,
    )
  }
  if (adherence.scheduled > 0) {
    lines.push(
      `  7-day adherence: ${adherence.taken}/${adherence.scheduled} doses (${adherence.percent}%)`,
    )
  }
  lines.push('---')
  lines.push('VITALS:')
  for (const v of VITAL_TYPES) {
    const items = data.vitals[v.key] || []
    if (items.length === 0) continue
    lines.push(`  ${v.label}:`)
    for (const it of items) {
      lines.push(`    - ${primaryValue(it, v)} on ${shortDate(it.createdAt)}`)
    }
  }
  lines.push('---')
  lines.push('RECENT ASSESSMENTS:')
  if (data.assessments.length === 0) lines.push('  (none)')
  for (const a of data.assessments.slice(0, 5)) {
    lines.push(
      `  - ${a.urgency || 'Assessment'} on ${fmtDate(a.createdAt)}; symptoms: ${(a.symptoms || []).join(', ')}`,
    )
  }
  lines.push('---')
  lines.push('Vitalis is a wellness guidance tool, not a medical record.')
  return lines.join('\n')
}
