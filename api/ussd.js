/**
 * OPTIONAL: USSD webhook as a Vercel serverless function.
 *
 * This lets the USSD service go live on the SAME Vercel project as the web
 * app (POST https://<your-app>.vercel.app/api/ussd) — no second host needed.
 *
 * ⚠ Step 1 caveat (by design): serverless functions are ephemeral, so the
 * in-memory store resets between invocations. Perfect for smoke-testing the
 * real network format; Step 2 (Firebase) makes data actually persist.
 *
 * For guaranteed long-lived sessions and warmer latency, the standalone
 * Express server in ../ussd/ (Render/Railway/Fly) is the production choice.
 */

import { createEngine } from '../ussd/src/engine.js';
import { createSessions } from '../ussd/src/sessions.js';
import { createStore } from '../ussd/src/store.js';
import { config } from '../ussd/src/config.js';

// Module scope: survives between warm invocations of the same instance.
const store = createStore();
const sessions = createSessions({ ttlMs: config.sessionTtlMs });
const engine = createEngine({ store, sessions });

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('END Method not allowed. POST required.');
  }

  // Africa's Talking posts application/x-www-form-urlencoded.
  const params = new URLSearchParams(await readBody(req));
  const sessionId = params.get('sessionId');
  const phoneNumber = params.get('phoneNumber');

  if (!sessionId || !phoneNumber) {
    return res.status(400).send('END Missing sessionId or phoneNumber.');
  }

  const { action, message } = engine.handle({
    sessionId,
    phoneNumber,
    text: params.get('text') || '',
    serviceCode: params.get('serviceCode'),
    networkCode: params.get('networkCode'),
  });

  res.setHeader('Content-Type', 'text/plain');
  return res.send(`${action} ${message}`);
}
