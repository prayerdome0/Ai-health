import React from 'react'
import { HeartPulse } from 'lucide-react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Vitalis ErrorBoundary caught error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          fontFamily: "'DM Sans', sans-serif",
          color: '#183a35',
          background: '#f7f8f5',
          textAlign: 'center'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            fontWeight: 700,
            fontSize: '22px',
            letterSpacing: '-1px',
            color: '#155d54',
            marginBottom: '20px'
          }}>
            <span style={{
              background: '#d8eee8',
              borderRadius: '9px',
              width: '33px',
              height: '33px',
              display: 'grid',
              placeItems: 'center'
            }}>
              <HeartPulse size={20} />
            </span>
            vitalis
          </div>
          <h1 style={{ fontSize: '28px', margin: '0 0 12px 0' }}>We hit a temporary bump</h1>
          <p style={{ maxWidth: '460px', color: '#617a75', margin: '0 0 24px 0', lineHeight: '1.5', fontSize: '15px' }}>
            We encountered an unexpected issue loading this view. Please refresh to continue using Vitalis.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#136d62',
              color: '#fff',
              border: 0,
              borderRadius: '8px',
              padding: '13px 22px',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: '15px',
              boxShadow: '0 8px 20px #136d6224'
            }}
          >
            Refresh page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
