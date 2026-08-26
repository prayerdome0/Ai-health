/**
 * Engine tests — run with:  npm test   (inside ussd/)
 *
 * Each test drives the engine exactly the way the phone network would:
 * one handle() call per round-trip, with text accumulating "input*input*...".
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createEngine } from '../src/engine.js';
import { createSessions } from '../src/sessions.js';
import { createStore } from '../src/store.js';

const PHONE = '+260970000001';

/** Builds an isolated engine + a caller helper that accumulates text. */
function rig({ ttlMs = 180000 } = {}) {
  let clock = 1_000_000;
  const sessions = createSessions({ ttlMs, now: () => clock });
  const store = createStore();
  const engine = createEngine({ store, sessions });
  const call = (sessionId, text) => engine.handle({ sessionId, phoneNumber: PHONE, text });
  return { engine, store, sessions, call, tick: (ms) => (clock += ms) };
}

/** Pre-registers a user so account/order tests start from a known state. */
function register(rig, phone = PHONE) {
  const s = 'reg';
  rig.engine.handle({ sessionId: s, phoneNumber: phone, text: '' }); // menu
  rig.engine.handle({ sessionId: s, phoneNumber: phone, text: '1' }); // register
  rig.engine.handle({ sessionId: s, phoneNumber: phone, text: '1*Jane Mwansa' });
  rig.engine.handle({ sessionId: s, phoneNumber: phone, text: '1*Jane Mwansa*2580' });
  return rig.engine.handle({ sessionId: s, phoneNumber: phone, text: '1*Jane Mwansa*2580*2580' });
}

// ---------------------------------------------------------------------------
// main menu
// ---------------------------------------------------------------------------

test('fresh dial shows the welcome menu (CON)', () => {
  const r = rig();
  const reply = r.call('s1', '');
  assert.equal(reply.action, 'CON');
  assert.match(reply.message, /Welcome to Your Business/);
  assert.match(reply.message, /1\. Register/);
  assert.match(reply.message, /5\. Exit/);
});

test('invalid main-menu option re-shows the menu', () => {
  const r = rig();
  r.call('s1', '');
  const reply = r.call('s1', '9');
  assert.equal(reply.action, 'CON');
  assert.match(reply.message, /Invalid option/);
  assert.match(reply.message, /1\. Register/);
});

test('option 5 exits with END', () => {
  const r = rig();
  r.call('s1', '');
  const reply = r.call('s1', '5');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /Thank you/);
  assert.equal(r.sessions.size, 0); // session cleaned up
});

// ---------------------------------------------------------------------------
// registration (option 1)
// ---------------------------------------------------------------------------

test('full registration flow issues an account number', () => {
  const r = rig();
  const reply = register(r);
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /Registration successful!/);
  assert.match(reply.message, /Jane Mwansa/);
  assert.match(reply.message, /BD-\d{4}/);

  const user = r.store.getUser(PHONE);
  assert.equal(user.name, 'Jane Mwansa');
  assert.equal(user.pin, '2580');
});

test('registration rejects an invalid name and re-prompts', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '1');
  const bad = r.call('s1', '1*ab');
  assert.equal(bad.action, 'CON');
  assert.match(bad.message, /Invalid name/);

  const ok = r.call('s1', '1*ab*John Banda');
  assert.match(ok.message, /Choose a 4-digit PIN/);
});

test('registration rejects a malformed PIN and re-prompts', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '1');
  r.call('s1', '1*John Banda');
  const bad = r.call('s1', '1*John Banda*12');
  assert.match(bad.message, /exactly 4 digits/);

  const ok = r.call('s1', '1*John Banda*12*1234');
  assert.match(ok.message, /confirm/i);
});

test('PIN mismatch restarts PIN entry, then succeeds', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '1');
  r.call('s1', '1*John Banda');
  r.call('s1', '1*John Banda*1234');
  const mismatch = r.call('s1', '1*John Banda*1234*9999');
  assert.match(mismatch.message, /did not match/);

  const retry = r.call('s1', '1*John Banda*1234*9999*4321');
  assert.match(retry.message, /confirm/i);
  const done = r.call('s1', '1*John Banda*1234*9999*4321*4321');
  assert.match(done.message, /Registration successful!/);
});

test('second registration attempt for the same number is blocked', () => {
  const r = rig();
  register(r);
  r.call('s2', '');
  const reply = r.call('s2', '1');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /already registered/);
  assert.match(reply.message, /BD-\d{4}/);
});

// ---------------------------------------------------------------------------
// check account (option 2)
// ---------------------------------------------------------------------------

test('unregistered caller is told to register first', () => {
  const r = rig();
  r.call('s1', '');
  const reply = r.call('s1', '2');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /No account found/);
});

test('registered caller sees their account summary', () => {
  const r = rig();
  register(r);
  r.call('s2', '');
  const reply = r.call('s2', '2');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /Account: BD-\d{4}/);
  assert.match(reply.message, /Jane Mwansa/);
  assert.match(reply.message, /Status: Active/);
});

// ---------------------------------------------------------------------------
// services (option 3)
// ---------------------------------------------------------------------------

test('price list screen shows every product', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '3');
  const reply = r.call('s1', '3*1');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /Starter Pack - K50/);
  assert.match(reply.message, /Premium Plan - K500/);
});

test('0 navigates back from Services to the main menu', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '3');
  const reply = r.call('s1', '3*0');
  assert.equal(reply.action, 'CON');
  assert.match(reply.message, /Welcome to Your Business/);
});

test('unregistered caller cannot place an order', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '3');
  const reply = r.call('s1', '3*2');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /registered customers/);
});

test('full order flow confirms an order with a reference and total', () => {
  const r = rig();
  register(r);
  r.call('s2', '');
  r.call('s2', '3');
  r.call('s2', '3*2'); // Place Order -> item menu
  const qtyPrompt = r.call('s2', '3*2*2'); // Growth Bundle (K150)
  assert.match(qtyPrompt.message, /Growth Bundle - K150 each/);

  const summary = r.call('s2', '3*2*2*3'); // qty 3 -> shows the summary
  assert.match(summary.message, /Total: K450/);

  const done = r.call('s2', '3*2*2*3*1'); // 1. Confirm

  assert.equal(done.action, 'END');
  assert.match(done.message, /Order confirmed!/);
  assert.match(done.message, /ORD-\d{4}/);
  assert.equal(r.store.ordersCount, 1);
  assert.equal(r.store.ordersByPhone(PHONE)[0].total, 450);
});

test('invalid quantity is rejected and re-prompted', () => {
  const r = rig();
  register(r);
  r.call('s2', '');
  r.call('s2', '3');
  r.call('s2', '3*2');
  r.call('s2', '3*2*1');
  const bad = r.call('s2', '3*2*1*0');
  assert.match(bad.message, /Invalid quantity/);
  const ok = r.call('s2', '3*2*1*0*2');
  assert.match(ok.message, /Total: K100/); // Starter Pack x2
});

test('order can be cancelled at the confirmation screen', () => {
  const r = rig();
  register(r);
  r.call('s2', '');
  r.call('s2', '3');
  r.call('s2', '3*2');
  r.call('s2', '3*2*1');
  r.call('s2', '3*2*1*1');
  const reply = r.call('s2', '3*2*1*1*2');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /cancelled/);
  assert.equal(r.store.ordersCount, 0);
});

// ---------------------------------------------------------------------------
// contact + session housekeeping
// ---------------------------------------------------------------------------

test('contact screen shows business contact details', () => {
  const r = rig();
  r.call('s1', '');
  const reply = r.call('s1', '4');
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /Call:/);
  assert.match(reply.message, /Email:/);
  assert.match(reply.message, /Hours:/);
});

test('deep dial (*123*1#) skips straight to the chosen option', () => {
  const r = rig();
  // First request arrives with text="1" and no prior welcome round-trip.
  const reply = r.call('s1', '1');
  assert.equal(reply.action, 'CON');
  assert.match(reply.message, /Please enter your full name/);
});

test('an idle session expires after the TTL', () => {
  const r = rig({ ttlMs: 1000 });
  r.call('s1', '');
  r.tick(2000); // 2s pass...
  const reply = r.call('s1', '1*Jane Mwansa'); // mid-flow text -> expired
  assert.equal(reply.action, 'END');
  assert.match(reply.message, /session has expired/);
});

test('a live session is reused across requests', () => {
  const r = rig();
  r.call('s1', '');
  r.call('s1', '3'); // now on services screen
  assert.equal(r.sessions.size, 1);
  // A different sessionId gets its own, independent menu
  const other = r.call('s9', '');
  assert.match(other.message, /Welcome/);
  assert.equal(r.sessions.size, 2);
});
