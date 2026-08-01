# Architecture
React + Vite + Firebase (Auth, Firestore, Storage, FCM, Analytics) + Vercel serverless AI proxy.

# Deployment
## Frontend — Vercel
1. Import the repo in Vercel (framework preset: Vite, build `npm run build`, output `dist`).
2. Add environment variables:
   - `AI_API_KEY` (required for the AI assistant; any OpenAI-compatible provider)
   - `AI_BASE_URL` (optional, default `https://api.openai.com/v1`)
   - `AI_MODEL` (optional, default `gpt-4o-mini`)
   - `VITE_FIREBASE_*` (optional overrides of the defaults in `src/firebase.js`)
3. Deploy. The `api/ai.js` function is picked up automatically.

## Database — Firebase
1. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`, or paste into
   Firestore → Rules in the console).
2. Optionally set the `role: Admin` custom claim on your account for the Admin Portal.
3. Optionally seed `doctor_profiles` / `emergency_locations` collections (admin write).

# Production Readiness Report
Auth, DB, Security verified (owner-scoped Firestore rules). AI assistant proxied
server-side so keys stay private. Disclaimer added. Pilot recommended before public launch.

# Notes
- Hospital/doctor seed data is illustrative; verify before relying on it.
- The AI assistant gives general guidance only and never diagnoses.
