import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
} from 'firebase/firestore'
import {
  Calendar,
  CalendarCheck,
  CheckCircle2,
  Clock,
  MapPin,
  Phone,
  Search,
  Star,
  Stethoscope,
  Video,
  X,
} from 'lucide-react'
import { db } from '../../firebase'
import { seedDoctors, specialties } from '../../data/doctors'

const timeSlots = ['09:00', '10:30', '12:00', '14:00', '15:30', '17:00']

export default function DoctorDirectory({ user, onRequireAuth }) {
  const [doctors, setDoctors] = useState(seedDoctors)
  const [specialty, setSpecialty] = useState('All')
  const [search, setSearch] = useState('')
  const [booking, setBooking] = useState(null) // doctor being booked
  const [form, setForm] = useState({ date: '', time: '', reason: '' })
  const [bookMsg, setBookMsg] = useState('')
  const [appointments, setAppointments] = useState([])
  const [callOpen, setCallOpen] = useState(null)
  const [loading, setLoading] = useState(true)

  // Admin-maintained doctor profiles from Firestore are merged on top of seeds
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const snap = await getDocs(query(collection(db, 'doctor_profiles')))
        if (alive && !snap.empty) {
          const remote = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          setDoctors([...remote, ...seedDoctors])
        }
      } catch (err) {
        console.warn('Could not load doctor profiles:', err)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setAppointments([])
      return
    }
    const q = query(
      collection(db, 'users', user.uid, 'appointments'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) =>
        setAppointments(
          snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            createdAt: d.data().createdAt?.toDate?.() || null,
          }))
        ),
      (err) => console.warn('Could not load appointments:', err)
    )
    return unsub
  }, [user])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return doctors.filter(
      (d) =>
        (specialty === 'All' || d.specialty === specialty) &&
        (!term ||
          d.name.toLowerCase().includes(term) ||
          d.specialty.toLowerCase().includes(term) ||
          d.hospital.toLowerCase().includes(term))
    )
  }, [doctors, specialty, search])

  const openBooking = (doctor) => {
    if (!user) {
      onRequireAuth()
      return
    }
    setBooking(doctor)
    setForm({ date: '', time: '', reason: '' })
    setBookMsg('')
  }

  const submitBooking = async (e) => {
    e.preventDefault()
    if (!form.date || !form.time) {
      setBookMsg('Please choose a date and time.')
      return
    }
    try {
      await addDoc(collection(db, 'users', user.uid, 'appointments'), {
        doctorId: booking.id,
        doctorName: booking.name,
        specialty: booking.specialty,
        hospital: booking.hospital,
        phone: booking.phone,
        date: form.date,
        time: form.time,
        reason: form.reason.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
      })
      setBooking(null)
      setBookMsg('')
    } catch (err) {
      console.error('Could not book appointment:', err)
      setBookMsg('We could not save this right now. Please try again.')
    }
  }

  const cancelAppointment = async (id) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'appointments', id))
    } catch (err) {
      console.error('Could not cancel appointment:', err)
    }
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <Stethoscope size={14} /> TELEMEDICINE
        </p>
        <h1>Find a doctor, book a visit.</h1>
        <p>
          Browse trusted clinicians, book an appointment in seconds, and join
          your video consultation from anywhere.
        </p>
      </div>

      <div className="toolbar">
        <div className="search-box">
          <Search size={16} />
          <input
            placeholder="Search doctor, specialty, hospital…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="chips">
          {['All', ...specialties].map((s) => (
            <button
              key={s}
              className={specialty === s ? 'chip selected' : 'chip'}
              onClick={() => setSpecialty(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="muted">Loading doctors…</p>}

      <div className="doctor-grid">
        {filtered.map((d) => (
          <article className="doctor-card" key={d.id}>
            <div className="doctor-top">
              <div className="doctor-avatar">{d.name.replace('Dr. ', '').charAt(0)}</div>
              <div>
                <h3>{d.name}</h3>
                <p className="specialty">{d.specialty}</p>
              </div>
              <span className={d.available ? 'badge ok' : 'badge'}>
                {d.available ? 'Available' : 'Busy'}
              </span>
            </div>
            <p className="doctor-bio">{d.bio}</p>
            <div className="doctor-meta">
              <span>
                <MapPin size={13} /> {d.hospital}, {d.city}
              </span>
              <span>
                <Star size={13} /> {d.rating} ({d.reviews})
              </span>
              <span>
                <Clock size={13} /> {d.years} yrs experience
              </span>
            </div>
            <div className="doctor-actions">
              <button className="complete small" onClick={() => openBooking(d)}>
                <Calendar size={15} /> Book appointment
              </button>
              <a className="ghost-btn" href={`tel:${d.phone}`}>
                <Phone size={14} /> Call clinic
              </a>
            </div>
          </article>
        ))}
        {!loading && filtered.length === 0 && (
          <p className="muted">No doctors match your search.</p>
        )}
      </div>

      <div className="panel appointments-panel">
        <div className="panel-head">
          <div>
            <h2>My appointments</h2>
            <p>Upcoming and past consultations you have booked.</p>
          </div>
          <CalendarCheck size={20} />
        </div>
        {!user && (
          <p className="panel-note">
            <button className="linklike" onClick={onRequireAuth}>
              Sign in
            </button>{' '}
            to book and track appointments.
          </p>
        )}
        {user && appointments.length === 0 && (
          <p className="panel-note">No appointments yet — book your first visit above.</p>
        )}
        {appointments.length > 0 && (
          <ul className="appointment-list">
            {appointments.map((a) => (
              <li key={a.id}>
                <div className="appt-date">
                  <strong>{a.date}</strong>
                  <span>{a.time}</span>
                </div>
                <div className="appt-info">
                  <strong>{a.doctorName}</strong>
                  <span>
                    {a.specialty} · {a.hospital || 'Video consult'}
                  </span>
                  {a.reason && <span className="appt-reason">“{a.reason}”</span>}
                </div>
                <span className={`badge ${a.status === 'pending' ? 'warn' : 'ok'}`}>{a.status}</span>
                <div className="appt-actions">
                  {a.status === 'pending' && (
                    <button className="icon-btn" title="Join video call" onClick={() => setCallOpen(a)}>
                      <Video size={15} />
                    </button>
                  )}
                  {a.status === 'pending' && (
                    <button className="icon-btn danger" title="Cancel" onClick={() => cancelAppointment(a.id)}>
                      <X size={15} />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {booking && (
        <div className="modal-backdrop" onClick={() => setBooking(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setBooking(null)} aria-label="Close">
              <X size={18} />
            </button>
            <h2>Book with {booking.name}</h2>
            <p className="muted">
              {booking.specialty} · {booking.hospital}
            </p>
            <form className="book-form" onSubmit={submitBooking}>
              <label className="auth-field">
                <span>Date</span>
                <input
                  type="date"
                  min={today}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  required
                />
              </label>
              <label className="auth-field">
                <span>Time</span>
                <div className="slot-row">
                  {timeSlots.map((t) => (
                    <button
                      type="button"
                      key={t}
                      className={form.time === t ? 'slot selected' : 'slot'}
                      onClick={() => setForm({ ...form, time: t })}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </label>
              <label className="auth-field">
                <span>Reason (optional)</span>
                <textarea
                  rows={3}
                  placeholder="Briefly describe what you need help with…"
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </label>
              {bookMsg && <p className="notice">{bookMsg}</p>}
              <button type="submit" className="complete wide">
                <CheckCircle2 size={16} /> Confirm booking
              </button>
            </form>
          </div>
        </div>
      )}

      {callOpen && (
        <div className="modal-backdrop" onClick={() => setCallOpen(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setCallOpen(null)} aria-label="Close">
              <X size={18} />
            </button>
            <div className="call-icon">
              <Video size={26} />
            </div>
            <h2>Video consultation — {callOpen.doctorName}</h2>
            <p>
              This is a demo of the consultation flow. In production, a secure
              video link would be generated here for your scheduled time.
            </p>
            <div className="sos-modal-links">
              <a className="ghost-btn" href={`tel:${callOpen.phone || ''}`}>
                <Phone size={15} /> Call the clinic instead
              </a>
            </div>
            <p className="disclaimer small">
              Your appointment is booked for {callOpen.date} at {callOpen.time}.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
