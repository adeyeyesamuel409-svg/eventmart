const BASE = process.env.BASE_URL || "http://localhost:3010";

let failed = 0;
const check = (ok, msg) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) failed++;
};

const req = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
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
};

(async () => {
  const health = await req("GET", "/health");
  check(health.status === 200 && health.data.status === "ok", "GET /health -> 200 ok");

  const book = await req("POST", "/products", { sku: "BOOK-001", name: "Cloud Engineering Handbook", priceCents: 3999, stock: 10 });
  check(book.status === 201 && !!book.data.id, "POST /products creates product");

  const mug = await req("POST", "/products", { sku: "MUG-001", name: "EventMart Ops Mug", priceCents: 1250, stock: 5 });
  check(mug.status === 201 && !!mug.data.id, "POST /products creates second product");

  const dup = await req("POST", "/products", { sku: "BOOK-001", name: "Clone", priceCents: 1, stock: 1 });
  check(dup.status === 409, "POST /products duplicate sku -> 409");

  const list = await req("GET", "/products");
  check(list.status === 200 && list.data.length >= 2, "GET /products lists products");

  const cart = await req("POST", "/carts");
  check(cart.status === 201 && !!cart.data.id, "POST /carts creates cart");
  const cartId = cart.data.id;

  const add1 = await req("POST", `/carts/${cartId}/items`, { productId: book.data.id, quantity: 2 });
  check(add1.status === 201, "POST /carts/:id/items adds item");

  const add2 = await req("POST", `/carts/${cartId}/items`, { productId: mug.data.id, quantity: 1 });
  check(add2.status === 201 && add2.data.subtotalCents === 2 * 3999 + 1250, "cart subtotal is correct");

  const noProduct = await req("POST", `/carts/${cartId}/items`, { productId: 999999, quantity: 1 });
  check(noProduct.status === 400, "POST /carts/:id/items unknown product -> 400");

  const checkout = await req("POST", `/carts/${cartId}/checkout`);
  check(
    checkout.status === 201 && checkout.data.status === "placed" && checkout.data.totalCents === 2 * 3999 + 1250,
    "POST /carts/:id/checkout places order"
  );

  const order = await req("GET", `/orders/${checkout.data.id}`);
  check(order.status === 200 && order.data.items.length === 2, "GET /orders/:id returns order with items");

  const bookAfter = await req("GET", `/products/${book.data.id}`);
  check(bookAfter.status === 200 && bookAfter.data.stock === 8, "checkout decremented stock (10 -> 8)");

  const cartAfter = await req("GET", `/carts/${cartId}`);
  check(cartAfter.status === 200 && cartAfter.data.items.length === 0, "checkout emptied the cart");

  const cart2 = await req("POST", "/carts");
  await req("POST", `/carts/${cart2.data.id}/items`, { productId: mug.data.id, quantity: 99 });
  const oversell = await req("POST", `/carts/${cart2.data.id}/checkout`);
  check(oversell.status === 409, "checkout with insufficient stock -> 409");

  const cart3 = await req("POST", "/carts");
  await req("POST", `/carts/${cart3.data.id}/items`, { productId: mug.data.id, quantity: 1 });
  const del = await req("DELETE", `/carts/${cart3.data.id}/items/${mug.data.id}`);
  check(del.status === 204, "DELETE /carts/:id/items/:productId removes item");

  const badJson = await fetch(`${BASE}/products`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{bad json",
  });
  check(badJson.status === 400, "POST invalid JSON -> 400");

  const missing = await req("GET", "/orders/does-not-exist");
  check(missing.status === 404, "GET /orders/:id unknown -> 404");

  if (failed === 0) {
    console.log("ALL CHECKS PASSED");
    process.exit(0);
  }
  console.log(`${failed} CHECK(S) FAILED`);
  process.exit(1);
})();
