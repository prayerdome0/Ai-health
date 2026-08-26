/**
 * In-memory USSD session store.
 *
 * A USSD "session" is one phone call to *123#: from the moment the customer
 * dials in until they see an END screen (or the session times out).
 *
 * While the call is open we remember which screen the user is on and any
 * data they have typed (e.g. their name during registration).
 *
 * NOTE: kept deliberately small and behind a tiny interface so Step 2/6 can
 * swap this for Redis/Firestore when we run on more than one server.
 */

export function createSessions({ ttlMs = 3 * 60 * 1000, now = () => Date.now() } = {}) {
  const sessions = new Map(); // sessionId -> { phone, screen, data, updatedAt }

  return {
    /** Returns the session if it exists and has not expired, else null. */
    get(sessionId) {
      const s = sessions.get(sessionId);
      if (!s) return null;
      if (now() - s.updatedAt > ttlMs) {
        sessions.delete(sessionId);
        return null; // idle too long — the network already closed the call
      }
      return s;
    },

    /** Creates or refreshes a session. */
    set(sessionId, session) {
      sessions.set(sessionId, { ...session, updatedAt: now() });
    },

    /** Ends a session (called automatically on every END screen). */
    delete(sessionId) {
      sessions.delete(sessionId);
    },

    /** Number of currently open sessions (used by the test suite / stats). */
    get size() {
      return sessions.size;
    },
  };
}
