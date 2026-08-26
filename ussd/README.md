# USSD Business Service — Step 1

A complete, working `*123#` USSD backend built with **Node.js + Express**,
testable **100% free** on your own machine. Firebase (Step 2), accounts
(Step 3), the admin dashboard (Step 4) and the live Zambian short code
(Step 6) all plug into this foundation without rewriting it.

```
Welcome to Your Business
1. Register        → name → 4-digit PIN → confirm → account number
2. Check Account   → account summary (only if registered)
3. Services        → 1. Price List   2. Place Order   3. Opening Hours
4. Contact Us      → phone / email / hours
5. Exit            → goodbye
```

## Run it (free, local)

```bash
cd ussd
npm install
npm run dev        # http://localhost:3000
```

Open **http://localhost:3000** → a phone simulator appears. Press
**Call \*123#** and navigate the menus with the keypad.

## Test it

```bash
npm test           # 19 automated menu-flow tests
```

## The parts

| File | What it is |
| --- | --- |
| `src/engine.js` | The menu state machine. Pure logic — every screen, validation, navigation. Provider-agnostic. |
| `src/sessions.js` | Remembers which screen each caller is on (with a 3-minute network-style timeout). |
| `src/store.js` | In-memory users + orders. Written as a small interface (`getUser`, `saveUser`, `createOrder`…) so **Step 2 swaps the internals for Firebase Firestore** and nothing else changes. |
| `src/config.js` | Business name, service code, currency, contact details, products. All overridable by env vars. |
| `server.js` | Express app: the provider webhook + simulator endpoints + stats. |
| `public/index.html` | Browser phone simulator (your free local test rig). |
| `test/engine.test.mjs` | Automated tests for every flow. |
| `../api/ussd.js` | Optional Vercel function exposing the same engine at `/api/ussd`. |

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/ussd` | **Provider webhook** (Africa's Talking format). Accepts `sessionId`, `phoneNumber`, `networkCode`, `serviceCode`, `text` (urlencoded); replies `CON …` / `END …` plain text. |
| `POST` | `/ussd/simulate` | Same engine, JSON in/out — used by the simulator page. |
| `GET` | `/api/stats` | `{ users, orders, liveSessions }` — feeds the future admin dashboard. |
| `GET` | `/health` | For uptime monitors. |

### How the webhook protocol works

Every USSD round-trip, the gateway POSTs one request where `text` contains
**every input of the session joined by `*`** (e.g. `3*2*1*5`). The engine
only reads the last segment — the session store already knows the path.
Replies must start with:

- `CON` — show the text and wait for the next input;
- `END` — show the text and close the call.

### Try the webhook with curl

```bash
curl -X POST http://localhost:3000/ussd \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "sessionId=abc123&phoneNumber=%2B260970000001&serviceCode=%2A123%23&networkCode=MTN&text="

# then continue the same session:
#   ... -d "sessionId=abc123&...&text=1"      (Register)
#   ... -d "sessionId=abc123&...&text=1*Jane Mwansa"
```

## Configuration (env vars)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | Server port. |
| `USSD_BUSINESS_NAME` | `Your Business` | Shown in the welcome menu. |
| `USSD_SERVICE_CODE` | `*123#` | Displayed in prompts (the real code is issued by the provider in Step 6). |
| `USSD_CURRENCY` | `K` | Price/total symbol. |
| `USSD_CONTACT_PHONE` / `_EMAIL` / `_HOURS` | see `src/config.js` | Contact Us screen. |
| `USSD_SESSION_TTL_MS` | `180000` | Idle session timeout. |

## What's next (the build order)

1. ✅ **Step 1 — Backend + menus** (this).
2. **Step 2 — Firebase**: implement the same `store` interface with Firestore
   (`firebase-admin`). Sessions can stay in memory; users/orders persist.
3. **Step 3 — Accounts**: PIN login, profile edits, balances.
4. **Step 4 — Admin dashboard**: web UI reading `users`, `orders` (the
   `/api/stats` endpoint already returns the counts).
5. **Step 5 — Free end-to-end test**: expose localhost via a tunnel
   (`npx localtunnel --port 3000` or `ngrok http 3000`) and point an
   Africa's Talking **sandbox** callback at it — test on a real phone with
   their shared code, still for free.
6. **Step 6 — Go live in Zambia**: Africa's Talking (or another aggregator
   like Cellulant/Clickatell) provisions a shared or dedicated code on
   MTN Zambia / Airtel / Zamtel and forwards to the same `/ussd` URL on
   Render (long-lived Express) or the Vercel `/api/ussd` function.
