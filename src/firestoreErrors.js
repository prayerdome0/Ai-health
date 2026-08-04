const RULES_MESSAGE =
  'Database access is not configured for your account. The app owner needs to deploy the included Firestore rules.'

function normalizedCode(error) {
  return String(error?.code || '').replace(/^firestore\//, '')
}

/**
 * Turn a Firestore error into an accurate, actionable message.
 *
 * Firestore reports permission and connectivity failures through the same
 * callbacks. Keeping the mapping here prevents a permission problem from
 * being incorrectly presented as a bad internet connection.
 */
export function friendlyFirestoreError(error, operation = 'save') {
  const code = normalizedCode(error)

  if (code === 'permission-denied') return RULES_MESSAGE

  if (code === 'unauthenticated') {
    return 'Your session expired. Please sign in again and retry.'
  }

  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'network-request-failed'
  ) {
    return 'The database is unreachable right now. Check your connection and try again.'
  }

  if (operation === 'load') {
    return 'Your saved records could not be loaded right now. Please try again.'
  }
  if (operation === 'delete') {
    return 'We could not delete this right now. Please try again.'
  }
  return 'We could not save this right now. Please try again.'
}

export { normalizedCode as firestoreErrorCode }
