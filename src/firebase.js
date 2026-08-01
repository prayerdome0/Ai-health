import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'
import { getAnalytics, isSupported } from 'firebase/analytics'

// Firebase client configuration. These values identify the public web app;
// authorization must always be enforced by Firebase Security Rules.
const firebaseConfig = {
  apiKey: import.meta.env?.VITE_FIREBASE_API_KEY || 'AIzaSyCl3C2YsBc5r7WS8HRyAtxc5r4LoC4OFfs',
  authDomain: import.meta.env?.VITE_FIREBASE_AUTH_DOMAIN || 'ai-health-d2c5b.firebaseapp.com',
  projectId: import.meta.env?.VITE_FIREBASE_PROJECT_ID || 'ai-health-d2c5b',
  storageBucket: import.meta.env?.VITE_FIREBASE_STORAGE_BUCKET || 'ai-health-d2c5b.firebasestorage.app',
  messagingSenderId: import.meta.env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '1018985914953',
  appId: import.meta.env?.VITE_FIREBASE_APP_ID || '1:1018985914953:web:3317363b3be4ad57299598',
}

let app = null
let auth = null
let db = null
let storage = null
let analytics = null
let googleProvider = null

try {
  app = !getApps().length ? initializeApp(firebaseConfig) : getApp()
  auth = getAuth(app)
  db = getFirestore(app)
  storage = getStorage(app)
  googleProvider = new GoogleAuthProvider()

  // Initialize Firebase Analytics safely in supported environments (e.g., browser)
  isSupported()
    .then((supported) => {
      if (supported && app) {
        analytics = getAnalytics(app)
      }
    })
    .catch((err) => {
      console.warn('Firebase analytics initialization warning:', err)
    })
} catch (error) {
  console.warn('Firebase initialization warning:', error)
}

export { auth, db, storage, analytics, googleProvider, firebaseConfig }
export default app
