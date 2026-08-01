# Vitalis — AI Health Companion

A Firebase-backed health guidance app. It provides a professional symptom guide that highlights safety-related next steps (not disease diagnoses), a daily wellness check-in, Google sign-in, and private Firestore storage.

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## Firebase setup

The supplied Firebase web configuration is in `src/firebase.js`, with Firebase Authentication, Cloud Firestore, Cloud Storage, and Google Analytics initialized and exported. Both default values and optional `VITE_FIREBASE_*` environment variable overrides are supported.

In the Firebase console for **ai-health-d2c5b**:

1. Enable **Authentication → Sign-in method → Google**.
2. Add your local and deployed domains to **Authentication → Settings → Authorized domains**.
3. Create a Cloud Firestore database.
4. Apply rules which ensure users can only access their own check-ins, for example:

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

> This is a wellness tool, not a diagnostic or emergency-care service.
Demo + Admin onboarding docs ready
