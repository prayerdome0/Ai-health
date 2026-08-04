import { useEffect, useMemo, useState } from 'react'
import {
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore'
import {
  CheckCircle2,
  Droplet,
  Heart,
  Save,
  User,
} from 'lucide-react'
import { db } from '../../firebase'
import { friendlyFirestoreError } from '../../firestoreErrors'
import {
  ageFromDob,
  BLOOD_GROUPS,
  COMMON_ALLERGIES,
  COMMON_CONDITIONS,
  profileToContext,
  SEX_OPTIONS,
} from '../../data/profile'

const empty = () => ({
  fullName: '',
  dob: '',
  sex: '',
  bloodGroup: '',
  heightCm: '',
  weightKg: '',
  conditions: [],
  allergies: [],
  notes: '',
})

export default function Profile({ user, onRequireAuth }) {
  const [form, setForm] = useState(empty())
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [error, setError] = useState('')

  // Subscribe to the user's single profile document.
  useEffect(() => {
    if (!user) {
      setForm(empty())
      setLoaded(true)
      return
    }
    const ref = doc(db, 'users', user.uid, 'profile', 'me')
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() || {}
        setForm({
          fullName: data.fullName || user.displayName || '',
          dob: data.dob || '',
          sex: data.sex || '',
          bloodGroup: data.bloodGroup || '',
          heightCm: data.heightCm ?? '',
          weightKg: data.weightKg ?? '',
          conditions: Array.isArray(data.conditions) ? data.conditions : [],
          allergies: Array.isArray(data.allergies) ? data.allergies : [],
          notes: data.notes || '',
        })
        setLoaded(true)
      },
      (err) => {
        console.warn('Could not load profile:', err)
        setError(friendlyFirestoreError(err, 'load'))
        setLoaded(true)
      },
    )
    return unsub
  }, [user])

  const age = useMemo(() => ageFromDob(form.dob), [form.dob])

  const toggleMulti = (field, value) => {
    setForm((f) => {
      const list = f[field] || []
      if (list.includes(value)) return { ...f, [field]: list.filter((v) => v !== value) }
      if (value === 'Other') {
        // 'Other' is always included; the user can also type a custom note.
        return { ...f, [field]: [...list, value] }
      }
      return { ...f, [field]: [...list, value] }
    })
  }

  const save = async (e) => {
    e.preventDefault()
    if (!user) {
      onRequireAuth()
      return
    }
    setSaving(true)
    setError('')
    try {
      const ref = doc(db, 'users', user.uid, 'profile', 'me')
      // Strip empties / coerce numbers so the doc stays clean.
      const payload = {
        fullName: (form.fullName || '').trim(),
        dob: form.dob || '',
        sex: form.sex || '',
        bloodGroup: form.bloodGroup || '',
        heightCm: form.heightCm === '' ? null : Number(form.heightCm),
        weightKg: form.weightKg === '' ? null : Number(form.weightKg),
        conditions: form.conditions || [],
        allergies: form.allergies || [],
        notes: (form.notes || '').trim(),
        updatedAt: serverTimestamp(),
      }
      await setDoc(ref, payload, { merge: true })
      setSavedAt(new Date())
      setTimeout(() => setSavedAt(null), 3000)
    } catch (err) {
      console.error('Could not save profile:', err)
      setError(friendlyFirestoreError(err, 'save'))
    } finally {
      setSaving(false)
    }
  }

  if (!user) {
    return (
      <section className="page">
        <div className="page-head">
          <p className="overline">
            <User size={14} /> PROFILE
          </p>
          <h1>Your health profile.</h1>
          <p>
            Save your date of birth, conditions and allergies once. The AI
            assistant and your "Share with doctor" summary will use them
            automatically.
          </p>
          <button className="complete" onClick={onRequireAuth}>
            Sign in to set up your profile
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="page-head">
        <p className="overline">
          <User size={14} /> HEALTH PROFILE
        </p>
        <h1>Your health profile.</h1>
        <p>
          Fill it in once — the AI assistant and your shareable summary use
          these details so they don't have to ask every time. Nothing is
          shared unless you choose to.
        </p>
      </div>

      {loaded && (
        <form className="profile-form" onSubmit={save}>
          <div className="profile-grid">
            <label className="auth-field">
              <span>Full name</span>
              <input
                type="text"
                placeholder="As you'd like it to appear on your summary"
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              />
            </label>

            <label className="auth-field">
              <span>Date of birth</span>
              <input
                type="date"
                value={form.dob}
                onChange={(e) => setForm({ ...form, dob: e.target.value })}
              />
            </label>

            <label className="auth-field">
              <span>Sex</span>
              <select
                value={form.sex}
                onChange={(e) => setForm({ ...form, sex: e.target.value })}
              >
                <option value="">Select…</option>
                {SEX_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="auth-field">
              <span>Blood group</span>
              <select
                value={form.bloodGroup}
                onChange={(e) => setForm({ ...form, bloodGroup: e.target.value })}
              >
                <option value="">Select…</option>
                {BLOOD_GROUPS.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>

            <label className="auth-field">
              <span>Height (cm)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.5"
                placeholder="e.g. 170"
                value={form.heightCm}
                onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
              />
            </label>

            <label className="auth-field">
              <span>Weight (kg)</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="e.g. 70"
                value={form.weightKg}
                onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
              />
            </label>
          </div>

          {age != null && (
            <p className="muted small profile-age">
              <Heart size={12} /> Age: {age} years old
            </p>
          )}

          <fieldset className="profile-multi">
            <legend>Conditions you live with</legend>
            <p className="muted small">Tap any that apply. The AI will factor these in.</p>
            <div className="chip-grid">
              {COMMON_CONDITIONS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={
                    form.conditions.includes(c) ? 'chip selected' : 'chip'
                  }
                  onClick={() => toggleMulti('conditions', c)}
                >
                  {c}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="profile-multi">
            <legend>Allergies</legend>
            <p className="muted small">Especially medication and food allergies.</p>
            <div className="chip-grid">
              {COMMON_ALLERGIES.map((a) => (
                <button
                  type="button"
                  key={a}
                  className={
                    form.allergies.includes(a) ? 'chip selected' : 'chip'
                  }
                  onClick={() => toggleMulti('allergies', a)}
                >
                  {a}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="auth-field">
            <span>Other notes (optional)</span>
            <textarea
              rows={3}
              placeholder="Anything else a clinician or the AI should know about you…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          {error && <p className="notice">{error}</p>}

          <div className="profile-actions">
            <button type="submit" className="complete" disabled={saving}>
              <Save size={15} /> {saving ? 'Saving…' : 'Save profile'}
            </button>
            {savedAt && (
              <span className="profile-saved">
                <CheckCircle2 size={14} /> Saved ·{' '}
                {profileToContext(form) || 'no details yet'}
              </span>
            )}
          </div>
        </form>
      )}

      <p className="disclaimer small page-disclaimer">
        <Droplet size={11} /> Your profile is private to your account. The AI
        assistant only uses it as context for the current conversation — it is
        never sent to anyone else.
      </p>
    </section>
  )
}
