import React, { useState, useEffect } from 'react'
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth'
import {
  X,
  LogIn,
  Mail,
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle2,
  HeartPulse,
} from 'lucide-react'

function getFriendlyAuthError(error) {
  const code = error?.code || ''
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'Invalid email or password. Please check your credentials.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.'
    case 'auth/weak-password':
      return 'Password must be at least 6 characters long.'
    case 'auth/invalid-email':
      return 'Please enter a valid email address.'
    case 'auth/too-many-requests':
      return 'Too many unsuccessful attempts. Please try again later.'
    case 'auth/network-request-failed':
      return 'Network error. Please check your internet connection.'
    default:
      return (
        error?.message ||
        'Authentication failed. Please verify Firebase Authentication settings.'
      )
  }
}

export default function AuthModal({
  isOpen,
  onClose,
  auth,
  googleProvider,
  initialMode = 'signin',
}) {
  const [mode, setMode] = useState(initialMode) // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode)
      setError('')
    }
  }, [isOpen, initialMode])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const handleGoogleSignIn = async () => {
    if (!auth || !googleProvider) {
      setError('Google Sign-In is not available in this environment.')
      return
    }
    setLoading(true)
    setError('')
    try {
      await signInWithPopup(auth, googleProvider)
      onClose()
    } catch (err) {
      setError(getFriendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const handleEmailSubmit = async (e) => {
    e.preventDefault()
    if (!auth) {
      setError('Authentication is not available in this environment.')
      return
    }
    if (!email || !password) {
      setError('Please fill in both email and password.')
      return
    }
    setLoading(true)
    setError('')
    try {
      if (mode === 'signin') {
        await signInWithEmailAndPassword(auth, email, password)
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password)
        if (name.trim() && cred.user) {
          try {
            await updateProfile(cred.user, { displayName: name.trim() })
          } catch (profileErr) {
            console.warn('Could not update profile display name:', profileErr)
          }
        }
      }
      onClose()
    } catch (err) {
      setError(getFriendlyAuthError(err))
    } finally {
      setLoading(false)
    }
  }

  const switchMode = (newMode) => {
    setMode(newMode)
    setError('')
  }

  return (
    <div className="auth-modal-backdrop" onClick={onClose}>
      <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="auth-modal-close"
          onClick={onClose}
          aria-label="Close modal"
        >
          <X size={18} />
        </button>

        <div className="auth-modal-header">
          <div className="brand">
            <span>
              <HeartPulse size={20} />
            </span>
            vitalis
          </div>
          <h3>
            {mode === 'signin' ? 'Sign in to your account' : 'Create an account'}
          </h3>
          <p>
            Securely save and review your health guidance assessments and check-ins.
          </p>
        </div>

        <button
          type="button"
          className="auth-google-button"
          onClick={handleGoogleSignIn}
          disabled={loading}
        >
          <svg
            className="google-icon"
            width="18"
            height="18"
            viewBox="0 0 48 48"
          >
            <path
              fill="#EA4335"
              d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
            />
            <path
              fill="#4285F4"
              d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
            />
            <path
              fill="#FBBC05"
              d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
            />
            <path
              fill="#34A853"
              d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
            />
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider">
          <span>or continue with email</span>
        </div>

        <form className="auth-form" onSubmit={handleEmailSubmit}>
          {mode === 'signup' && (
            <label className="auth-field">
              <span>Full Name</span>
              <div className="auth-input-wrapper">
                <User size={16} />
                <input
                  type="text"
                  placeholder="Your Name (optional)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={loading}
                />
              </div>
            </label>
          )}

          <label className="auth-field">
            <span>Email Address</span>
            <div className="auth-input-wrapper">
              <Mail size={16} />
              <input
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </label>

          <label className="auth-field">
            <span>Password</span>
            <div className="auth-input-wrapper">
              <Lock size={16} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder={
                  mode === 'signup' ? 'At least 6 characters' : '••••••••'
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                disabled={loading}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {error && (
            <div className="auth-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="auth-submit-button"
            disabled={loading}
          >
            {loading ? (
              'Please wait...'
            ) : mode === 'signin' ? (
              <>
                <LogIn size={16} /> Sign in with Email
              </>
            ) : (
              <>
                <CheckCircle2 size={16} /> Create Account
              </>
            )}
          </button>
        </form>

        <div className="auth-modal-footer">
          {mode === 'signin' ? (
            <p>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode('signup')}
              >
                Sign up
              </button>
            </p>
          ) : (
            <p>
              Already have an account?{' '}
              <button
                type="button"
                className="auth-switch-link"
                onClick={() => switchMode('signin')}
              >
                Sign in
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
