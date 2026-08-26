/**
 * USSD menu engine — the heart of the service.
 *
 * The engine is a *session-based state machine*:
 *   - Every dial-in starts a session and shows the MAIN menu.
 *   - Each user input moves the session to the next screen
 *     (main -> register:name -> register:pin -> ...).
 *   - Any screen can reply CON (conversation continues) or END (call ends).
 *
 * It is 100% provider-agnostic and side-effect free apart from the stores,
 * which makes it trivially testable (see test/engine.test.mjs) and reusable:
 * the Express webhook (server.js) and the Vercel function (api/ussd.js)
 * both simply feed it { sessionId, phoneNumber, text } and render the reply.
 *
 * Input format expected (Africa's Talking convention, also used by most
 * aggregators): `text` is every input of the session joined with '*',
 * e.g. "3*2*1*5" means the user pressed 3, then 2, then 1, then typed 5.
 * The engine only ever needs the LAST segment — the session already knows
 * the path taken so far.
 */

import { config } from './config.js';

const CON = 'CON'; // "Continue" — show menu and wait for more input
const END = 'END'; // "End" — close the USSD session

export function createEngine({ store, sessions, cfg = config } = {}) {
  const c = cfg;

  // ---- helpers -----------------------------------------------------------

  const con = (message) => ({ action: CON, message });
  const end = (message) => ({ action: END, message });

  const mainMenuText = () =>
    `Welcome to ${c.businessName}\n1. Register\n2. Check Account\n3. Services\n4. Contact Us\n5. Exit`;

  const firstName = (full) => full.trim().split(/\s+/)[0];

  const formatMoney = (amount) => `${c.currency}${amount.toLocaleString('en-US')}`;

  const dateLabel = (iso) => new Date(iso).toLocaleDateString('en-GB');

  const product = (id) => c.products.find((p) => p.id === id);

  /**
   * Runs one USSD request. Called on EVERY round-trip with the phone.
   */
  function handle({ sessionId, phoneNumber, text = '' }) {
    const input = lastSegment(text);
    const session = sessions.get(sessionId);

    // No live session:
    //  a) text is empty          -> fresh dial-in (*123#), welcome menu.
    //  b) single input, no '*'   -> "deep dial" like *123*1#, where the first
    //                                choice arrives on the very first request:
    //                                start at the main menu and apply it.
    //  c) several inputs joined  -> the session was lost mid-flow (server
    //     with '*'                  restart / idle timeout). Restart cleanly.
    if (!session) {
      const fresh = { phone: phoneNumber, screen: 'main', data: {} };

      if (input === '') {
        sessions.set(sessionId, fresh);
        return con(mainMenuText());
      }

      if (!String(text).includes('*')) {
        const reply = route(fresh, input); // deep dial
        if (reply.action === END) sessions.delete(sessionId);
        else sessions.set(sessionId, fresh);
        return reply;
      }

      return end(
        `Sorry, your session has expired.\nPlease dial ${c.serviceCode} again.`
      );
    }

    const reply = route(session, input);

    // CON keeps the session alive; END always closes it.
    if (reply.action === END) sessions.delete(sessionId);
    else sessions.set(sessionId, session);

    return reply;
  }

  /** Decides what to do with `input` depending on the screen the user is on. */
  function route(session, input) {
    switch (session.screen) {
      case 'main':
        return screenMain(session, input);

      // -- registration flow ------------------------------------------------
      case 'register:name':
        return screenRegisterName(session, input);
      case 'register:pin':
        return screenRegisterPin(session, input);
      case 'register:pin2':
        return screenRegisterPin2(session, input);

      // -- services flow ------------------------------------------------------
      case 'services':
        return screenServices(session, input);
      case 'order:item':
        return screenOrderItem(session, input);
      case 'order:qty':
        return screenOrderQty(session, input);
      case 'order:confirm':
        return screenOrderConfirm(session, input);

      default:
        // Unknown screen (e.g. after a redeploy) — recover gracefully.
        session.screen = 'main';
        session.data = {};
        return con(mainMenuText());
    }
  }

  // ---- screens -------------------------------------------------------------

  function screenMain(session, input) {
    switch (input) {
      case '':
        return con(mainMenuText()); // user pressed OK without typing
      case '1': {
        const user = store.getUser(session.phone);
        if (user) {
          return end(
            `This number is already registered.\nName: ${user.name}\nAccount: ${user.accountNo}`
          );
        }
        session.screen = 'register:name';
        return con('Registration\nPlease enter your full name:');
      }
      case '2': {
        const user = store.getUser(session.phone);
        if (!user) {
          return end(
            `No account found for this number.\nDial ${c.serviceCode} and choose 1 to Register.`
          );
        }
        const orders = store.ordersByPhone(session.phone);
        return end(
          `Account: ${user.accountNo}\nName: ${user.name}\nStatus: Active\n` +
            `Orders placed: ${orders.length}\nMember since ${dateLabel(user.createdAt)}`
        );
      }
      case '3':
        session.screen = 'services';
        return con(
          `Services\n1. Price List\n2. Place Order\n3. Opening Hours\n0. Back`
        );
      case '4':
        return end(
          `${c.businessName}\nCall: ${c.contact.phone}\nEmail: ${c.contact.email}\n` +
            `Hours: ${c.contact.hours}`
        );
      case '5':
        return end(`Thank you for using ${c.businessName}.\nDial ${c.serviceCode} anytime.`);
      default:
        return con(`Invalid option.\n${mainMenuText()}`);
    }
  }

  function screenRegisterName(session, input) {
    const name = input.replace(/\s+/g, ' ').trim();
    if (name.length < 3 || !/^[A-Za-z][A-Za-z '.-]*$/.test(name)) {
      return con('Invalid name.\nEnter your full name (letters only):');
    }
    session.data.name = name;
    session.screen = 'register:pin';
    return con(`Hi ${firstName(name)}.\nChoose a 4-digit PIN:`);
  }

  function screenRegisterPin(session, input) {
    if (!/^\d{4}$/.test(input)) {
      return con('PIN must be exactly 4 digits.\nEnter PIN:');
    }
    session.data.pin = input;
    session.screen = 'register:pin2';
    return con('Re-enter PIN to confirm:');
  }

  function screenRegisterPin2(session, input) {
    if (input !== session.data.pin) {
      delete session.data.pin;
      session.screen = 'register:pin';
      return con('PINs did not match.\nChoose a new 4-digit PIN:');
    }
    const user = store.saveUser({
      phone: session.phone,
      name: session.data.name,
      pin: session.data.pin,
    });
    return end(
      `Registration successful!\nName: ${user.name}\nAccount: ${user.accountNo}\n` +
        `Dial ${c.serviceCode} to continue.`
    );
  }

  function screenServices(session, input) {
    switch (input) {
      case '1':
        return end(
          `Price List\n` +
            c.products.map((p) => `${p.id}. ${p.name} - ${formatMoney(p.price)}`).join('\n')
        );
      case '2': {
        const user = store.getUser(session.phone);
        if (!user) {
          return end(
            `Orders are for registered customers.\nDial ${c.serviceCode} and choose 1 to Register.`
          );
        }
        session.screen = 'order:item';
        return con(
          `Place Order\n` +
            c.products.map((p) => `${p.id}. ${p.name} - ${formatMoney(p.price)}`).join('\n') +
            `\n0. Back`
        );
      }
      case '3':
        return end(`${c.businessName}\nOpening Hours: ${c.contact.hours}`);
      case '0':
        session.screen = 'main';
        return con(mainMenuText());
      default:
        return con(`Invalid option.\nServices\n1. Price List\n2. Place Order\n3. Opening Hours\n0. Back`);
    }
  }

  function screenOrderItem(session, input) {
    if (input === '0') {
      session.screen = 'services';
      return con(`Services\n1. Price List\n2. Place Order\n3. Opening Hours\n0. Back`);
    }
    const p = product(input);
    if (!p) {
      return con(
        `Invalid option.\n` +
          c.products.map((x) => `${x.id}. ${x.name} - ${formatMoney(x.price)}`).join('\n') +
          `\n0. Back`
      );
    }
    session.data.itemId = p.id;
    session.screen = 'order:qty';
    return con(`${p.name} - ${formatMoney(p.price)} each\nEnter quantity (1-99):`);
  }

  function screenOrderQty(session, input) {
    const qty = Number(input);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
      return con('Invalid quantity.\nEnter quantity (1-99):');
    }
    const p = product(session.data.itemId);
    session.data.qty = qty;
    session.screen = 'order:confirm';
    return con(
      `Order Summary\nItem: ${p.name} x ${qty}\nTotal: ${formatMoney(p.price * qty)}\n1. Confirm\n2. Cancel`
    );
  }

  function screenOrderConfirm(session, input) {
    if (input === '2') return end('Order cancelled.');
    if (input !== '1') {
      return con('Invalid option.\n1. Confirm\n2. Cancel');
    }
    const order = store.createOrder({
      phone: session.phone,
      product: product(session.data.itemId),
      qty: session.data.qty,
    });
    return end(
      `Order confirmed!\nRef: ${order.ref}\n${order.itemName} x ${order.qty}\n` +
        `Total: ${formatMoney(order.total)}\nWe will contact you shortly.`
    );
  }

  return { handle };
}

// ---- utilities ----------------------------------------------------------------

/** Africa's Talking sends every input joined with '*'; we need only the last. */
export function lastSegment(text) {
  if (!text) return '';
  const parts = String(text).split('*');
  return parts[parts.length - 1].trim();
}
