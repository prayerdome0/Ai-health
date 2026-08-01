# Vitalis — AI Health Companion

A Firebase-backed health guidance app with a real AI assistant, emergency SOS,
telemedicine booking, a pregnancy tracker, and private Firestore storage for
everything you save. Google and Email/Password sign-in are supported.

## Features

| Feature | Route | What it does |
| --- | --- | --- |
| AI assistant | chat widget (bottom-right) | Free LLM via `/api/ai` — no API key needed |
| Symptom guide | `#/` | Safety-first guidance + optional AI review; save to your account |
| Daily check-in | `#/` | Track how you feel day to day; saved privately |
| Doctor directory | `#/doctors` | Browse clinicians, book appointments, video-consult flow |
| Pregnancy tracker | `#/pregnancy` | Week-by-week milestones, notes for your clinician, weekly AI tips |
| Emergency SOS | `#/emergency` | One-tap emergency calls, hospital finder, emergency contacts |
| My health | `#/history` | Every saved record in one private place |
| Admin portal | `#/admin` | Platform stats for users with the `Admin` custom claim |
| Sign up | `#/signup` | Standalone create-account / sign-in page |

## Run locally

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

## AI setup — free, no API key needed

The AI works out of the box at **zero cost**. The app talks to a Vercel
serverless function (`api/ai.js`), which by default calls **Pollinations.ai** —
a free, keyless, OpenAI-compatible provider (free models cost nothing, no
signup). No environment variables are required.

To raise the free rate limit (~1 request / 5s), you can optionally register a
free key at <https://enter.pollinations.ai> and set `AI_API_KEY` — the proxy
will then use that key with the free provider. You can also point `AI_API_KEY`
at any other OpenAI-compatible provider:

```
AI_API_KEY=sk-...          # optional — free provider is used without it
AI_BASE_URL=https://api.openai.com/v1   # optional, override for other providers
AI_MODEL=openai            # optional — free default is "openai"
```

If the AI service is ever unreachable, the app gracefully falls back to
offline, rule-based guidance — it never breaks.

## Firebase setup

The supplied Firebase web configuration is in `src/firebase.js`, with Firebase
Authentication, Cloud Firestore, Cloud Storage, and Google Analytics
initialized and exported. Both default values and optional `VITE_FIREBASE_*`
environment variable overrides are supported.

In the Firebase console for **ai-health-d2c5b**:

1. Enable **Authentication → Sign-in method → Google** and **Email/Password**.
2. Add your local and deployed domains to **Authentication → Settings →
   Authorized domains**.
3. Create a Cloud Firestore database.
4. **Deploy the rules in `firestore.rules`** — this is what allows users to
   save their assessments, check-ins, appointments, and contacts:

```bash
# with Firebase CLI
firebase deploy --only firestore:rules
# or paste the contents of firestore.rules into
# Firestore → Rules in the Firebase console, then Publish
```

The rules grant each signed-in user read/write access to **only their own**
data under `users/{uid}/...`, public read for the emergency-location list,
signed-in read for the doctor directory, and full access to users with the
`Admin` custom claim (Firebase console → Authentication → Users → "Set custom
claims" → `{"role": "Admin"}`). Without deploying these rules, saves fail with
"We could not save this right now."

> This is a wellness tool, not a diagnostic or emergency-care service.
