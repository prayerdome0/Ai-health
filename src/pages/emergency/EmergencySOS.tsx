import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore'
import {
  AlertTriangle,
  MapPin,
  Navigation,
  Phone,
  PhoneCall,
  Siren,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { db } from '../../firebase'
import { emergencyNumbers, seedHospitals } from '../../data/hospitals'

export default function EmergencySOS({ user, onRequireAuth }) {
  const [region, setRegion] = useState('uganda')
  const [contacts, setContacts] = useState([])
  const [newContact, setNewContact] = useState({ name: '', phone: '', relation: '' })
  const [contactMsg, setContactMsg] = useState('')
  const [sosOpen, setSosOpen] = useState(false)
  const [location, setLocation] = useState(null)
  const [locState, setLocState] = useState('idle') // idle | locating | done | error
  const [hospitals] = useState(seedHospitals)

  const numbers = emergencyNumbers[region]

  useEffect(() => {
    if (!user) return
    const q = query(
      collection(db, 'users', user.uid, 'emergencyContacts'),
      orderBy('createdAt', 'desc')
    )
    const unsub = onSnapshot(
      q,
      (snap) =>
        setContacts(
          snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.() || null }))
        ),
      (err) => {
        console.warn('Could not load emergency contacts:', err)
        setContactMsg('Could not load your contacts right now.')
      }
    )
    return unsub
  }, [user])

  const locate = () => {
    if (!('geolocation' in navigator)) {
      setLocState('error')
      return
    }
    setLocState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setLocState('done')
      },
      () => setLocState('error'),
      { timeout: 10000 }
    )
  }

  const mapsLink = useMemo(() => {
    if (location) return `https://www.google.com/maps?q=${location.lat},${location.lng}`
    return null
  }, [location])

  const addContact = async (e) => {
    e.preventDefault()
    if (!newContact.name.trim() || !newContact.phone.trim()) {
      setContactMsg('Please enter a name and phone number.')
      return
    }
    if (!user) {
      onRequireAuth()
      return
    }
    try {
      await addDoc(collection(db, 'users', user.uid, 'emergencyContacts'), {
        ...newContact,
        createdAt: new Date(),
      })
      setNewContact({ name: '', phone: '', relation: '' })
      setContactMsg('')
    } catch (err) {
      console.error('Could not save emergency contact:', err)
      setContactMsg('We could not save this right now. Please try again.')
    }
  }

  const removeContact = async (id) => {
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'emergencyContacts', id))
    } catch (err) {
      console.error('Could not remove contact:', err)
    }
  }

  const emergencyCall = numbers.emergency.startsWith('+') ? numbers.emergency : `tel:${numbers.emergency}`
  const policeCall = numbers.police ? `tel:${numbers.police}` : emergencyCall
  const ambulanceCall = numbers.ambulance ? `tel:${numbers.ambulance}` : emergencyCall

  return (
    <section className="page page-emergency">
      <div className="page-head">
        <p className="overline">
          <Siren size={14} /> EMERGENCY SOS
        </p>
        <h1>Help, when it matters most.</h1>
        <p>
          One tap to reach local emergency services, your trusted contacts, and
          the nearest hospitals. Always call official emergency numbers in a
          life-threatening situation.
        </p>
      </div>

      <div className="sos-actions">
        <button className="sos-button" onClick={() => setSosOpen(true)}>
          <span className="sos-ring" />
          <PhoneCall size={30} />
          <strong>SOS — I need help</strong>
          <small>Call emergency services in {numbers.label}</small>
        </button>

        <div className="sos-side">
          <div className="region-row">
            <label>My region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {Object.entries(emergencyNumbers).map(([key, r]) => (
                <option key={key} value={key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="quick-calls">
            <a href={emergencyCall} className="quick-call">
              <Phone size={16} /> Emergency {numbers.emergency}
            </a>
            <a href={policeCall} className="quick-call">
              <Phone size={16} /> Police{numbers.police ? ` ${numbers.police}` : ''}
            </a>
            {numbers.ambulance && (
              <a href={ambulanceCall} className="quick-call">
                <Phone size={16} /> Ambulance {numbers.ambulance}
              </a>
            )}
          </div>
          <div className="locate-box">
            <button className="locate-btn" onClick={locate} disabled={locState === 'locating'}>
              <Navigation size={15} />
              {locState === 'locating' ? 'Locating…' : location ? 'Update my location' : 'Share my location'}
            </button>
            {locState === 'done' && location && (
              <p className="locate-ok">
                <MapPin size={13} /> Location captured
                {mapsLink && (
                  <a href={mapsLink} target="_blank" rel="noreferrer">
                    Open in Maps
                  </a>
                )}
              </p>
            )}
            {locState === 'error' && <p className="locate-err">Could not get location — allow location access.</p>}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>My emergency contacts</h2>
              <p>People you want notified in an emergency.</p>
            </div>
            <Users size={20} />
          </div>

          {!user && (
            <p className="panel-note">
              <button className="linklike" onClick={onRequireAuth}>
                Sign in
              </button>{' '}
              to save emergency contacts securely.
            </p>
          )}

          {contacts.length > 0 && (
            <ul className="contact-list">
              {contacts.map((c) => (
                <li key={c.id}>
                  <div className="contact-avatar">{c.name.charAt(0).toUpperCase()}</div>
                  <div className="contact-info">
                    <strong>{c.name}</strong>
                    <span>
                      {c.phone} {c.relation ? `· ${c.relation}` : ''}
                    </span>
                  </div>
                  <a className="icon-btn" href={`tel:${c.phone}`} title="Call">
                    <Phone size={15} />
                  </a>
                  <a className="icon-btn" href={`sms:${c.phone}`} title="Message">
                    <Users size={15} />
                  </a>
                  <button className="icon-btn danger" onClick={() => removeContact(c.id)} title="Remove">
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="inline-form" onSubmit={addContact}>
            <input
              placeholder="Name"
              value={newContact.name}
              onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
            />
            <input
              placeholder="Phone"
              value={newContact.phone}
              onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
            />
            <input
              placeholder="Relation (optional)"
              value={newContact.relation}
              onChange={(e) => setNewContact({ ...newContact, relation: e.target.value })}
            />
            <button type="submit" className="complete small">
              <UserPlus size={15} /> Add
            </button>
          </form>
          {contactMsg && <p className="notice">{contactMsg}</p>}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <h2>Hospitals & clinics</h2>
              <p>Tap a card to call or get directions.</p>
            </div>
            <MapPin size={20} />
          </div>
          <div className="hospital-grid">
            {hospitals.map((h) => (
              <article className="hospital-card" key={h.id}>
                <div>
                  <h3>{h.name}</h3>
                  <p>{h.city}</p>
                  <span className="tag">{h.type}</span>
                </div>
                <div className="hospital-actions">
                  <a href={`tel:${h.phone}`} className="icon-btn">
                    <Phone size={15} /> Call
                  </a>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(h.name + ' ' + h.city)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="icon-btn"
                  >
                    <Navigation size={15} /> Directions
                  </a>
                </div>
              </article>
            ))}
          </div>
          <p className="disclaimer small">
            Hospital details are illustrative and may change — verify with local
            listings before relying on them in an emergency.
          </p>
        </div>
      </div>

      {sosOpen && (
        <div className="modal-backdrop" onClick={() => setSosOpen(false)}>
          <div className="modal-card sos-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSosOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            <div className="sos-modal-icon">
              <AlertTriangle size={26} />
            </div>
            <h2>Emergency call — {numbers.label}</h2>
            <p>
              This will dial <strong>{numbers.emergency}</strong> on your phone.
              Only call if you are facing a genuine emergency.
            </p>
            <a className="complete wide sos-dial" href={emergencyCall}>
              <PhoneCall size={17} /> Call {numbers.emergency}
            </a>
            <div className="sos-modal-links">
              {location && mapsLink && (
                <a href={mapsLink} target="_blank" rel="noreferrer" className="ghost-btn">
                  <Navigation size={15} /> Share location on map
                </a>
              )}
              {contacts.length > 0 && (
                <a
                  href={`sms:${contacts[0].phone}?body=${encodeURIComponent(
                    `EMERGENCY: I need help. My location: ${location ? mapsLink : 'sharing shortly'}. — Vitalis SOS`
                  )}`}
                  className="ghost-btn"
                >
                  <Users size={15} /> Text {contacts[0].name}
                </a>
              )}
            </div>
            <p className="disclaimer small">
              If you cannot speak, tap the map link so someone can find you, or
              call and leave the line open.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
