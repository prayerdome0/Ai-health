import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Firebase client configuration. These values identify the public web app;
// authorization must always be enforced by Firebase Security Rules.
const firebaseConfig = {
  apiKey: 'AIzaSyCl3C2YsBc5r7WS8HRyAtxc5r4LoC4OFfs',
  authDomain: 'ai-health-d2c5b.firebaseapp.com',
  projectId: 'ai-health-d2c5b',
  storageBucket: 'ai-health-d2c5b.firebasestorage.app',
  messagingSenderId: '1018985914953',
  appId: '1:1018985914953:web:b7cb637a61a7de59299598',
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getFirestore(app)
export const googleProvider = new GoogleAuthProvider()
export default app
