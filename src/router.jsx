import { useEffect, useState } from 'react'

/**
 * Minimal hash-based router (no extra dependencies).
 * Routes look like: #/, #/doctors, #/pregnancy, #/emergency, #/history, #/admin, #/signup
 */

function readRoute() {
  const hash = window.location.hash.replace(/^#/, '')
  return hash || '/'
}

export function useHashRoute() {
  const [route, setRoute] = useState(readRoute)
  useEffect(() => {
    const onChange = () => {
      setRoute(readRoute())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(to) {
  if (readRoute() === to) {
    window.scrollTo({ top: 0 })
    return
  }
  window.location.hash = to
}

export function Link({ to, className, children, onClick, ...rest }) {
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={onClick}
      {...rest}
    >
      {children}
    </a>
  )
}
