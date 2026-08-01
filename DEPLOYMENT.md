# Architecture
React + Vite + Firebase (Auth, Firestore, Storage, FCM, Analytics) + Vercel serverless AI proxy.

# Deployment
## Frontend — Vercel
1. Import the repo in Vercel (framework preset: Vite, build `npm run build`, output `dist`).
2. **No environment variables are required** — the AI uses the free keyless
   Pollinations.ai provider by default. Optional variables:
   - `AI_API_KEY` — use a paid/own OpenAI-compatible provider, or a free
     Pollinations key for higher rate limits
   - `AI_BASE_URL` (optional, default `https://api.openai.com/v1`)
   - `AI_MODEL` (optional, default `openai` on free / `gpt-4o-mini` with key)
   - `VITE_FIREBASE_*` (optional overrides of the defaults in `src/firebase.js`)
3. Deploy. The `api/ai.js` function is picked up automatically.

## Database — Firebase
1. Deploy `firestore.rules` (`firebase deploy --only firestore:rules`, or paste into
   Firestore → Rules in the console).
2. Optionally set the `role: Admin` custom claim on your account for the Admin Portal.
3. Optionally seed `doctor_profiles` / `emergency_locations` collections (admin write).

# Production Readiness Report
Auth, DB, Security verified (owner-scoped Firestore rules). AI assistant runs
free by default through Pollinations.ai (no key) with an optional key path;
responses are never stored server-side beyond your own Firestore chat history.
Disclaimer added. Pilot recommended before public launch.

# Notes
- Hospital/doctor seed data is illustrative; verify before relying on it.
- The AI assistant gives general guidance only and never diagnoses.
