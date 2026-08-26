/**
 * USSD server — Step 1.
 *
 * Endpoints:
 *   POST /ussd            Africa's Talking-compatible webhook (urlencoded
 *                         form: sessionId, phoneNumber, networkCode,
 *                         serviceCode, text). Replies "CON ..." / "END ..."
 *                         as plain text — the format MTN/Airtel/Zamtel
 *                         aggregators in Zambia use via Africa's Talking.
 *   POST /ussd/simulate   Same engine, JSON in/out — used by the built-in
 *                         phone simulator (see /).
 *   GET  /api/stats       Quick counts (users, orders, live sessions).
 *   GET  /health          Uptime check for hosting platforms.
 *   GET  /                Browser phone simulator for FREE local testing.
 */

import express from 'express';
import { createEngine } from './src/engine.js';
import { createSessions } from './src/sessions.js';
import { createStore } from './src/store.js';
import { config } from './src/config.js';

const PORT = Number(process.env.PORT || 3000);

// One shared instance. In Step 2 the store's internals move to Firebase;
// these three lines are the only wiring the server knows about.
const store = createStore();
const sessions = createSessions({ ttlMs: config.sessionTtlMs });
const engine = createEngine({ store, sessions });

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(express.static('public'));

// ---- webhook (Africa's Talking format) ---------------------------------------
app.post('/ussd', (req, res) => {
  const { sessionId, serviceCode, phoneNumber, networkCode, text } = req.body;

  if (!sessionId || !phoneNumber) {
    return res.status(400).send('END Missing sessionId or phoneNumber.');
  }

  console.log(
    `[USSD] ${sessionId.slice(-8)} ${phoneNumber} (${networkCode || '?'}) ` +
      `${serviceCode || ''} text="${text ?? ''}"`
  );

  const { action, message } = engine.handle({
    sessionId,
    phoneNumber,
    text: text || '',
  });

  console.log(`       -> ${action} ${message.split('\n')[0]}`);
  res.set('Content-Type', 'text/plain');
  return res.send(`${action} ${message}`);
});

// ---- JSON endpoint for the browser simulator ----------------------------------
app.post('/ussd/simulate', (req, res) => {
  const { sessionId, phoneNumber, text, networkCode, serviceCode } = req.body;
  if (!sessionId || !phoneNumber) {
    return res.status(400).json({ error: 'sessionId and phoneNumber are required.' });
  }
  const reply = engine.handle({ sessionId, phoneNumber, text: text || '' });
  return res.json(reply);
});

// ---- monitoring ----------------------------------------------------------------
app.get('/api/stats', (_req, res) => {
  res.json({
    business: config.businessName,
    serviceCode: config.serviceCode,
    users: store.usersCount,
    orders: store.ordersCount,
    liveSessions: sessions.size,
  });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`${config.businessName} USSD server`);
  console.log(`  Simulator   http://localhost:${PORT}/`);
  console.log(`  Webhook     http://localhost:${PORT}/ussd   (Africa's Talking format)`);
  console.log(`  Service code ${config.serviceCode}`);
});
