# Vitalis — AI Health Companion

A Firebase-backed health guidance app with a real AI assistant, emergency SOS,
telemedicine booking, a pregnancy tracker, and private Firestore storage for
everything you save. Google and Email/Password sign-in are supported.

## Features

| Feature | Route | What it does |
| --- | --- | --- |
| AI assistant | chat widget (bottom-right) | Ask questions; powered by an LLM via `/api/ai` |
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

## AI setup (required for the AI assistant)

The AI runs through a Vercel serverless function (`api/ai.js`) so your API key
never ships to the browser. It works with any OpenAI-compatible provider.
Add these environment variables in **Vercel → Settings → Environment
Variables** (or a local `.env`):

```
AI_API_KEY=sk-...          # required (or OPENAI_API_KEY)
AI_BASE_URL=https://api.openai.com/v1   # optional, override for other providers
AI_MODEL=gpt-4o-mini        # optional
```

If `AI_API_KEY` is not set, the app still works — the AI features gracefully
fall back to offline, rule-based guidance and tell you what to configure.

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
