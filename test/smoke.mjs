const GATEWAY_URL = process.env.GATEWAY_URL || "";
const CATALOG_URL = GATEWAY_URL || process.env.CATALOG_URL || "http://localhost:3011";
const CART_URL = GATEWAY_URL || process.env.CART_URL || "http://localhost:3012";
const ORDERS_URL = GATEWAY_URL || process.env.ORDERS_URL || "http://localhost:3013";
const PAYMENTS_URL = GATEWAY_URL || process.env.PAYMENTS_URL || "http://localhost:3014";
const NOTIFICATIONS_URL = GATEWAY_URL || process.env.NOTIFICATIONS_URL || "http://localhost:3015";

const RUN_ID = Date.now();
const SKU = (name) => `${name}-${RUN_ID}`;

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) failed++;
};

const req = async (method, base, path, body) => {
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0, data: null };
  }
};

const waitFor = async (fn, predicate, { attempts = 30, delayMs = 1000 } = {}) => {
  for (let i = 0; i < attempts; i++) {
    const result = await fn();
    if (result && predicate(result)) return result;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
};

(async () => {
  if (GATEWAY_URL) {
    const root = await req("GET", CATALOG_URL, "/");
    check(root.status === 200 && root.data.name === "eventmart", "gateway routes / -> 200 index");
    const gateway = await req("GET", CATALOG_URL, "/products");
    check(gateway.status === 200 && Array.isArray(gateway.data), "gateway routes /products -> 200 array");
  } else {
    for (const [name, base] of [
      ["catalog", CATALOG_URL],
      ["cart", CART_URL],
      ["orders", ORDERS_URL],
      ["payments", PAYMENTS_URL],
      ["notifications", NOTIFICATIONS_URL],
    ]) {
      const health = await req("GET", base, "/health");
      check(health.status === 200 && health.data.status === "ok", `${name} GET /health -> 200 ok`);
    }
  }

  const book = await req("POST", CATALOG_URL, "/products", {
    sku: SKU("BOOK"),
    name: "Cloud Engineering Handbook",
    priceCents: 3999,
    stock: 10,
  });
  check(book.status === 201 && !!book.data.id, "POST /products creates product");
  if (book.status !== 201) {
    console.log("ABORT: catalog not reachable, remaining checks skipped");
    console.log(`${1} CHECK(S) FAILED`);
    process.exit(1);
  }

  const mug = await req("POST", CATALOG_URL, "/products", {
    sku: SKU("MUG"),
    name: "EventMart Ops Mug",
    priceCents: 1250,
    stock: 5,
  });
  check(mug.status === 201 && !!mug.data.id, "POST /products creates second product");

  const dup = await req("POST", CATALOG_URL, "/products", { sku: book.data.sku, name: "Clone", priceCents: 1, stock: 1 });
  check(dup.status === 409, "POST /products duplicate sku -> 409");

  const list = await req("GET", CATALOG_URL, "/products");
  check(list.status === 200 && list.data.length >= 2, "GET /products lists products");

  const lookup = await req("POST", CATALOG_URL, "/products/lookup", { ids: [book.data.id, mug.data.id] });
  check(lookup.status === 200 && lookup.data.length === 2, "POST /products/lookup returns products");

  const cart = await req("POST", CART_URL, "/carts");
  check(cart.status === 201 && !!cart.data.id, "POST /carts creates cart");
  const cartId = cart.data.id;

  const add1 = await req("POST", CART_URL, `/carts/${cartId}/items`, { productId: book.data.id, quantity: 2 });
  check(add1.status === 201, "POST /carts/:id/items adds item");

  const add2 = await req("POST", CART_URL, `/carts/${cartId}/items`, { productId: mug.data.id, quantity: 1 });
  check(add2.status === 201 && add2.data.subtotalCents === 2 * 3999 + 1250, "cart subtotal is correct");

  const noProduct = await req("POST", CART_URL, `/carts/${cartId}/items`, { productId: 999999, quantity: 1 });
  check(noProduct.status === 400, "POST /carts/:id/items unknown product -> 400");

  const checkout = await req("POST", CART_URL, `/carts/${cartId}/checkout`);
  check(
    checkout.status === 201 && checkout.data.status === "placed" && checkout.data.totalCents === 2 * 3999 + 1250,
    "POST /carts/:id/checkout places order"
  );

  const order = await req("GET", ORDERS_URL, `/orders/${checkout.data.id}`);
  check(order.status === 200 && order.data.items.length === 2, "GET /orders/:id returns order with items");

  const bookAfter = await req("GET", CATALOG_URL, `/products/${book.data.id}`);
  check(bookAfter.status === 200 && bookAfter.data.stock === 8, "checkout decremented stock (10 -> 8)");

  const cartAfter = await req("GET", CART_URL, `/carts/${cartId}`);
  check(cartAfter.status === 200 && cartAfter.data.items.length === 0, "checkout emptied the cart");

  const payment = await waitFor(
    () => req("GET", PAYMENTS_URL, `/payments/${checkout.data.id}`),
    (r) => r.status === 200
  );
  check(
    payment !== null && payment.data.status === "succeeded" && payment.data.amountCents === 2 * 3999 + 1250,
    "payment.succeeded published and recorded for order"
  );

  const paidOrder = await waitFor(
    () => req("GET", ORDERS_URL, `/orders/${checkout.data.id}`),
    (r) => r.status === 200 && r.data.status === "paid"
  );
  check(paidOrder !== null, "order status transitions to paid via payment.succeeded event");

  const notifications = await waitFor(
    () => req("GET", NOTIFICATIONS_URL, "/notifications"),
    (r) =>
      r.status === 200 &&
      r.data.some((n) => n.subject.includes(checkout.data.id)) &&
      r.data.some((n) => n.eventType === "payment.succeeded" && n.body.includes(checkout.data.id))
  );
  check(notifications !== null, "notifications sent for order.placed and payment.succeeded");

  const cart2 = await req("POST", CART_URL, "/carts");
  await req("POST", CART_URL, `/carts/${cart2.data.id}/items`, { productId: mug.data.id, quantity: 99 });
  const oversell = await req("POST", CART_URL, `/carts/${cart2.data.id}/checkout`);
  check(oversell.status === 409, "checkout with insufficient stock -> 409");

  const cart3 = await req("POST", CART_URL, "/carts");
  await req("POST", CART_URL, `/carts/${cart3.data.id}/items`, { productId: mug.data.id, quantity: 1 });
  const del = await req("DELETE", CART_URL, `/carts/${cart3.data.id}/items/${mug.data.id}`);
  check(del.status === 204, "DELETE /carts/:id/items/:productId removes item");

  const consoleTable = await req("POST", CATALOG_URL, "/products", {
    sku: SKU("CONSOLE"),
    name: "Vintage Mixing Console",
    priceCents: 250000,
    stock: 2,
  });
  check(consoleTable.status === 201, "POST /products creates expensive product");
  const cart4 = await req("POST", CART_URL, "/carts");
  await req("POST", CART_URL, `/carts/${cart4.data.id}/items`, { productId: consoleTable.data.id, quantity: 1 });
  const bigCheckout = await req("POST", CART_URL, `/carts/${cart4.data.id}/checkout`);
  check(bigCheckout.status === 201 && bigCheckout.data.totalCents === 250000, "checkout places expensive order");

  const failedPayment = await waitFor(
    () => req("GET", PAYMENTS_URL, `/payments/${bigCheckout.data.id}`),
    (r) => r.status === 200
  );
  check(failedPayment !== null && failedPayment.data.status === "failed", "payment.failed published and recorded for order over limit");

  const failedOrder = await waitFor(
    () => req("GET", ORDERS_URL, `/orders/${bigCheckout.data.id}`),
    (r) => r.status === 200 && r.data.status === "payment_failed"
  );
  check(failedOrder !== null, "order status transitions to payment_failed via payment.failed event");

  const failedNote = await waitFor(
    () => req("GET", NOTIFICATIONS_URL, "/notifications"),
    (r) => r.status === 200 && r.data.some((n) => n.eventType === "payment.failed" && n.body.includes(bigCheckout.data.id))
  );
  check(failedNote !== null, "notification sent for payment.failed");

  let badJsonStatus = 0;
  try {
    const badRes = await fetch(`${CATALOG_URL}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{bad json",
    });
    badJsonStatus = badRes.status;
  } catch {
    badJsonStatus = 0;
  }
  check(badJsonStatus === 400, "POST invalid JSON -> 400");

  const missing = await req("GET", ORDERS_URL, "/orders/does-not-exist");
  check(missing.status === 404, "GET /orders/:id unknown -> 404");

  if (failed === 0) {
    console.log("ALL CHECKS PASSED");
    process.exit(0);
  }
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
})();
