import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

const STORAGE_KEY = 'vitalis_disclaimer_accepted_v1'

export default function DisclaimerNotice() {
  const [open, setOpen] = useState(() => {
    try {
      return !localStorage.getItem(STORAGE_KEY)
    } catch {
      return true
    }
  })
  const [expanded, setExpanded] = useState(false)

  if (!open) return null

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* storage unavailable */
    }
    setOpen(false)
  }

  return (
    <div className="disclaimer-banner" role="alert">
      <div className="disclaimer-icon">
        <AlertTriangle size={18} />
      </div>
      <div className="disclaimer-body">
        <strong>Vitalis is a wellness guidance tool — not a doctor.</strong>
        {expanded && (
          <p>
            It does not diagnose, treat, or replace professional medical care.
            Saved records are private to your account. If you have severe chest
            pain, difficulty breathing, stroke symptoms, or feel unsafe, call
            your local emergency number now.
          </p>
        )}
        <div className="disclaimer-actions">
          <button className="linklike" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show less' : 'Read full disclaimer'}
          </button>
          <button className="complete tiny" onClick={accept}>
            I understand
          </button>
        </div>
      </div>
      <button className="disclaimer-close" onClick={accept} aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  )
}
