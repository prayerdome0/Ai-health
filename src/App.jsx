import { useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { Activity, AlertTriangle, ArrowRight, Bot, CheckCircle2, ChevronRight, HeartPulse, LogIn, LogOut, ShieldCheck, Sparkles, Stethoscope, X } from 'lucide-react'
import { auth, db, googleProvider } from './firebase'
import clinicianImage from './assets/health-professional-hero.png'

const symptoms = ['Fever or chills', 'Cough', 'Headache', 'Sore throat', 'Fatigue', 'Stomach discomfort', 'Shortness of breath', 'Chest pain', 'Rash or skin changes']
const wellnessQuestions = [['How are you feeling today?', ['Great', 'Okay', 'Not my best']], ['How would you rate your energy?', ['High', 'Steady', 'Low']], ['Did you get restorative sleep?', ['Yes', 'Somewhat', 'No']]]
const urgent = ['Shortness of breath', 'Chest pain']

function assessmentFor(selected) {
  if (selected.some(s => urgent.includes(s))) return { level: 'Urgent care recommended', tone: 'urgent', text: 'Some symptoms you selected can be serious. Please seek urgent in-person medical assessment now, especially if symptoms are new, severe, worsening, or paired with fainting, confusion, or blue lips.', topics: ['Heart or breathing conditions', 'Severe infection', 'Other urgent causes'] }
  if (selected.length === 0) return null
  const topics = []
  if (selected.includes('Fever or chills') || selected.includes('Cough') || selected.includes('Sore throat')) topics.push('Respiratory infection')
  if (selected.includes('Headache') || selected.includes('Fatigue')) topics.push('Viral illness, stress, or dehydration')
  if (selected.includes('Stomach discomfort')) topics.push('Digestive irritation or infection')
  if (selected.includes('Rash or skin changes')) topics.push('Skin irritation or allergy')
  return { level: 'Monitor & consider clinical advice', tone: 'monitor', text: 'Your answers can have many explanations. Rest, fluids, and tracking changes may help. Contact a clinician if symptoms are severe, persist, worsen, or concern you.', topics: topics.length ? topics : ['General wellness concern'] }
}

export default function App() {
  const [user, setUser] = useState(null), [chosen, setChosen] = useState([]), [note, setNote] = useState(''), [answers, setAnswers] = useState(Array(3).fill('')), [saved, setSaved] = useState(false), [message, setMessage] = useState('')
  useEffect(() => {
    if (!auth) {
      setUser(null)
      return
    }
    try {
      const unsubscribe = onAuthStateChanged(
        auth,
        (u) => setUser(u),
        (err) => {
          console.warn('Auth state change warning:', err)
          setUser(null)
        }
      )
      return () => unsubscribe()
    } catch (e) {
      console.warn('Firebase auth listener warning:', e)
      setUser(null)
    }
  }, [])
  const assessment = useMemo(() => assessmentFor(chosen), [chosen])
  const toggle = symptom => setChosen(current => current.includes(symptom) ? current.filter(x => x !== symptom) : [...current, symptom])
  const login = async () => {
    if (!auth || !googleProvider) {
      setMessage('Sign-in is unavailable in this environment.')
      return
    }
    try {
      await signInWithPopup(auth, googleProvider)
      setMessage('')
    } catch {
      setMessage('Sign-in is unavailable. Enable Google in Firebase Authentication and authorize this domain.')
    }
  }
  const saveAssessment = async () => {
    if (!assessment) return setMessage('Select at least one symptom to receive a safety-guided assessment.')
    if (!user || !db) return setMessage('Sign in to securely save your assessment.')
    try { await addDoc(collection(db, 'users', user.uid, 'assessments'), { symptoms: chosen, note, urgency: assessment.level, createdAt: serverTimestamp() }); setSaved(true); setMessage('') } catch { setMessage('We could not save this right now. Please try again.') }
  }
  const saveCheckin = async () => {
    if (answers.some(a => !a)) return setMessage('Please answer each daily check-in question.')
    if (!user || !db) return setMessage('Sign in to securely save your check-in.')
    try { await addDoc(collection(db, 'users', user.uid, 'checkIns'), { answers, createdAt: serverTimestamp() }); setMessage('Your daily check-in is saved.') } catch { setMessage('We could not save this right now. Please try again.') }
  }
  return <main>
    <nav><div className="brand"><span><HeartPulse size={20}/></span>vitalis</div><div className="nav-right"><a href="#assessment">Symptom guide</a><a href="#checkin">Daily check-in</a>{user ? <button className="profile" onClick={() => auth && signOut(auth).catch(() => {})}><img src={user.photoURL || ''} alt=""/><span>{user.displayName?.split(' ')[0] || 'Account'}</span><LogOut size={15}/></button> : <button className="sign-in" onClick={login}><LogIn size={16}/> Sign in</button>}</div></nav>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> PERSONAL HEALTH GUIDANCE</div><h1>Clarity for every<br/><em>health question.</em></h1><p>Use a thoughtful symptom guide, record how you feel, and get clear next-step guidance—without replacing your clinician.</p><a className="hero-button" href="#assessment">Check symptoms <ArrowRight size={18}/></a><div className="trust"><ShieldCheck size={17}/> Private by design · Built for guidance, not diagnosis</div></div><div className="hero-photo"><img src={clinicianImage} alt="Clinician holding a tablet"/><div className="photo-card"><CheckCircle2/><span>Support that puts<br/>your safety first</span></div></div></section>
    <section className="safety-strip"><AlertTriangle size={18}/><span><b>Emergency?</b> If you have severe chest pain, severe breathing difficulty, stroke symptoms, loss of consciousness, or feel unsafe, seek emergency help immediately.</span></section>
    <section className="assessment section" id="assessment"><div className="section-intro"><p className="overline">SYMPTOM GUIDE</p><h2>Let’s understand<br/>what’s going on.</h2><p>Select the symptoms you notice. Our guide flags when prompt in-person care could be important and helps you prepare for a conversation with a healthcare professional.</p><div className="privacy-note"><ShieldCheck size={17}/> Nothing is saved unless you choose to save it.</div></div><div className="assessment-card"><div className="card-top"><span className="ai-icon"><Bot size={21}/></span><div><h3>Health guidance assistant</h3><p>Choose all that apply today</p></div></div><div className="symptom-grid">{symptoms.map(symptom => <button className={chosen.includes(symptom) ? 'symptom selected' : 'symptom'} onClick={() => { toggle(symptom); setSaved(false) }} key={symptom}>{chosen.includes(symptom) && <CheckCircle2 size={16}/>} {symptom}</button>)}</div><label className="note-label">Anything else you’d like to note? <span>Optional</span><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="For example: when it started, what makes it better or worse…"/></label><button className="complete wide" onClick={saveAssessment}>Review my symptoms <ArrowRight size={17}/></button>{message && <p className="notice">{message}</p>}{assessment && <div className={`result ${assessment.tone}`}><div><span className="result-icon">{assessment.tone === 'urgent' ? <AlertTriangle/> : <Activity/>}</span><div><p className="overline">SAFETY GUIDANCE</p><h3>{assessment.level}</h3></div></div><p>{assessment.text}</p><strong>Topics to discuss with a clinician</strong><ul>{assessment.topics.map(topic => <li key={topic}><ChevronRight size={15}/>{topic}</li>)}</ul><p className="disclaimer">This is not a diagnosis. Only a qualified healthcare professional can diagnose a condition.</p>{!saved && <button className="save-link" onClick={saveAssessment}>{user ? 'Save this assessment' : 'Sign in to save'}</button>}{saved && <p className="saved"><CheckCircle2 size={16}/> Assessment saved securely.</p>}</div>}</div></section>
    <section className="checkin section" id="checkin"><div className="checkin-head"><div><p className="overline">DAILY CHECK-IN</p><h2>A minute for you.</h2><p>Small, regular reflections can make patterns easier to notice.</p></div><div className="date">{new Intl.DateTimeFormat('en-US', {weekday:'long',month:'long',day:'numeric'}).format(new Date())}</div></div><div className="questions">{wellnessQuestions.map(([question, options], i) => <article className="question" key={question}><span className="number">0{i+1}</span><div><h3>{question}</h3><div className="options">{options.map(option => <button key={option} onClick={() => setAnswers(a => a.map((x, j) => j === i ? option : x))} className={answers[i] === option ? 'selected' : ''}>{answers[i] === option && <CheckCircle2 size={15}/>} {option}</button>)}</div></div></article>)}</div><button className="complete" onClick={saveCheckin}>Save check-in <ArrowRight size={17}/></button></section>
    <section className="principles"><div><p className="overline">HOW VITALIS HELPS</p><h2>Designed for care,<br/>not guesswork.</h2></div><div className="principle-list"><article><Activity/><div><h3>Safety-led guidance</h3><p>Our guide prioritizes urgent warning signs and encourages timely professional care.</p></div></article><article><Stethoscope/><div><h3>Not a diagnosis</h3><p>Symptoms overlap. Vitalis helps you organize information, but it cannot diagnose disease.</p></div></article><article><ShieldCheck/><div><h3>Private by design</h3><p>Your saved entries belong to your account and are protected by Firebase access controls.</p></div></article></div></section>
    <footer><div className="brand"><span><HeartPulse size={19}/></span>vitalis</div><p>For general wellbeing support only. Not medical advice, diagnosis, or emergency care.</p><p>© {new Date().getFullYear()} Vitalis Health</p></footer>
  </main>
}
