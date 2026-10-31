const { randomUUID } = require("node:crypto");
const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const CATALOG_URL = process.env.CATALOG_URL || "http://localhost:3011";
const ORDERS_URL = process.env.ORDERS_URL || "http://localhost:3013";

function upstreamError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function fetchJson(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw upstreamError(502, `upstream unreachable: ${url}`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function lookupProducts(ids) {
  const { status, data } = await fetchJson(`${CATALOG_URL}/products/lookup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (status !== 200) throw upstreamError(502, "catalog lookup failed");
  return new Map(data.map((p) => [p.id, p]));
}

async function loadCart(cartId) {
  const [carts] = await pool.query("SELECT id, created_at AS createdAt FROM carts WHERE id = ?", [cartId]);
  if (carts.length === 0) return null;
  const [rows] = await pool.query(
    "SELECT product_id AS productId, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_id",
    [cartId]
  );
  let items = rows.map((r) => ({ ...r, name: null, priceCents: null }));
  if (rows.length > 0) {
    const byId = await lookupProducts(rows.map((r) => r.productId));
    items = rows.map((r) => {
      const product = byId.get(r.productId);
      return {
        productId: r.productId,
        quantity: r.quantity,
        name: product ? product.name : null,
        priceCents: product ? product.priceCents : null,
      };
    });
  }
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * (item.priceCents ?? 0), 0);
  return { ...carts[0], items, subtotalCents };
}

router.post("/", async (req, res) => {
  const id = randomUUID();
  await pool.query("INSERT INTO carts (id) VALUES (?)", [id]);
  res.status(201).json({ id, items: [], subtotalCents: 0 });
});

router.get("/:id", async (req, res) => {
  const cart = await loadCart(req.params.id);
  if (!cart) return res.status(404).json({ error: "cart not found" });
  res.json(cart);
});

router.post("/:id/items", async (req, res) => {
  const { productId, quantity } = req.body || {};
  if (!productId || !Number.isInteger(quantity) || quantity <= 0) {
    return res.status(400).json({ error: "productId and a positive integer quantity are required" });
  }
  const product = await fetchJson(`${CATALOG_URL}/products/${productId}`);
  if (product.status === 404) return res.status(400).json({ error: "productId does not exist" });
  if (product.status !== 200) throw upstreamError(502, "catalog lookup failed");
  const [carts] = await pool.query("SELECT id FROM carts WHERE id = ?", [req.params.id]);
  if (carts.length === 0) return res.status(404).json({ error: "cart not found" });

  await pool.query(
    `INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE quantity = quantity + VALUES(quantity)`,
    [req.params.id, productId, quantity]
  );
  res.status(201).json(await loadCart(req.params.id));
});

router.delete("/:id/items/:productId", async (req, res) => {
  const [result] = await pool.query(
    "DELETE FROM cart_items WHERE cart_id = ? AND product_id = ?",
    [req.params.id, req.params.productId]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: "cart item not found" });
  res.status(204).end();
});

router.post("/:id/checkout", async (req, res) => {
  const cartId = req.params.id;
  const [items] = await pool.query(
    "SELECT product_id AS productId, quantity FROM cart_items WHERE cart_id = ? ORDER BY product_id",
    [cartId]
  );
  if (items.length === 0) {
    return res.status(404).json({ error: "cart not found or empty" });
  }

  const reserved = await fetchJson(`${CATALOG_URL}/stock/decrement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items }),
  });
  if (reserved.status !== 200) {
    return res.status(reserved.status).json(reserved.data || { error: "stock reservation failed" });
  }

  const soldItems = reserved.data.items.map(({ productId, name, priceCents, quantity }) => ({
    productId,
    quantity,
    name,
    unitPriceCents: priceCents,
  }));

  let created;
  try {
    created = await fetchJson(`${ORDERS_URL}/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: soldItems }),
    });
  } catch (err) {
    await fetchJson(`${CATALOG_URL}/stock/increment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    throw err;
  }
  if (created.status !== 201) {
    await fetchJson(`${CATALOG_URL}/stock/increment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    throw upstreamError(502, "order creation failed");
  }

  await pool.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
  res.status(201).json(created.data);
});

module.exports = router;
