/**
 * In-memory data store: registered users and placed orders.
 *
 * This is Step 1's "database". It is intentionally written as a small,
 * well-defined interface (getUser, saveUser, createOrder, ...) so that
 * Step 2 can replace the internals with Firebase Firestore calls WITHOUT
 * changing any menu logic — the engine only talks to these functions.
 */

export function createStore() {
  /** phone -> { phone, name, pin, accountNo, createdAt } */
  const users = new Map();

  /** ref -> { ref, phone, itemId, itemName, qty, unitPrice, total, createdAt } */
  const orders = new Map();

  let nextAccountNo = 1001;
  let nextOrderSeq = 1;

  return {
    // ---- users -----------------------------------------------------------

    getUser(phone) {
      return users.get(phone) || null;
    },

    saveUser({ phone, name, pin }) {
      const user = {
        phone,
        name,
        pin,
        accountNo: `BD-${nextAccountNo++}`,
        createdAt: new Date().toISOString(),
      };
      users.set(phone, user);
      return user;
    },

    get usersCount() {
      return users.size;
    },

    listUsers() {
      return [...users.values()].map(({ pin, ...safe }) => safe);
    },

    // ---- orders ----------------------------------------------------------

    createOrder({ phone, product, qty }) {
      const order = {
        ref: `ORD-${String(nextOrderSeq++).padStart(4, '0')}`,
        phone,
        itemId: product.id,
        itemName: product.name,
        qty,
        unitPrice: product.price,
        total: product.price * qty,
        createdAt: new Date().toISOString(),
      };
      orders.set(order.ref, order);
      return order;
    },

    ordersByPhone(phone) {
      return [...orders.values()].filter((o) => o.phone === phone);
    },

    get ordersCount() {
      return orders.size;
    },

    listOrders() {
      return [...orders.values()];
    },
  };
}
