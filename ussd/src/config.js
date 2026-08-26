/**
 * Business configuration for the USSD service.
 *
 * Everything a real deployment would change lives here (or in environment
 * variables), so the menu logic never needs editing to rebrand the service.
 */

export const config = {
  /** Shown in menus. Override with USSD_BUSINESS_NAME. */
  businessName: process.env.USSD_BUSINESS_NAME || 'Your Business',

  /** The short code the customer dials. */
  serviceCode: process.env.USSD_SERVICE_CODE || '*123#',

  /** Currency symbol used in the price list / order totals. */
  currency: process.env.USSD_CURRENCY || 'K',

  /** Shown on the "Contact Us" screen. */
  contact: {
    phone: process.env.USSD_CONTACT_PHONE || '+260 97 302 8342',
    email: process.env.USSD_CONTACT_EMAIL || 'zschaussimbaya@gmail.com',
    hours: process.env.USSD_CONTACT_HOURS || 'Mon-Sat 08:00-18:00',
  },

  /** Products offered through "Services -> Place Order". */
  products: [
    { id: '1', name: 'Starter Pack', price: 50 },
    { id: '2', name: 'Growth Bundle', price: 150 },
    { id: '3', name: 'Premium Plan', price: 500 },
  ],

  /** How long an idle USSD session stays alive (ms). 180s = network default. */
  sessionTtlMs: Number(process.env.USSD_SESSION_TTL_MS || 3 * 60 * 1000),
};
