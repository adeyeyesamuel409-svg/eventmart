const { randomUUID } = require("node:crypto");
const express = require("express");
const { pool } = require("../db");
const { publishEvent } = require("../events");

const router = express.Router();

const CATALOG_URL = process.env.CATALOG_URL || "http://localhost:3011";
const ORDERS_TOPIC_ARN = process.env.ORDERS_TOPIC_ARN || "";

const SELECT = "SELECT id, status, total_cents AS totalCents, created_at AS createdAt FROM orders";

async function productNames(ids) {
  const names = new Map();
  if (ids.length === 0) return names;
  try {
    const res = await fetch(`${CATALOG_URL}/products/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (res.status !== 200) return names;
    const data = await res.json();
    for (const product of data) names.set(product.id, product.name);
  } catch {
    return names;
  }
  return names;
}

async function loadOrder(orderId) {
  const [orders] = await pool.query(`${SELECT} WHERE id = ?`, [orderId]);
  if (orders.length === 0) return null;
  const [items] = await pool.query(
    "SELECT product_id AS productId, quantity, unit_price_cents AS unitPriceCents FROM order_items WHERE order_id = ? ORDER BY id",
    [orderId]
  );
  const names = await productNames(items.map((item) => item.productId));
  return {
    ...orders[0],
    items: items.map((item) => ({ ...item, name: names.get(item.productId) ?? null })),
  };
}

router.get("/", async (req, res) => {
  const [rows] = await pool.query(`${SELECT} ORDER BY created_at DESC`);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items must be a non-empty array" });
  }
  for (const item of items) {
    if (!item || !Number.isInteger(item.productId) || item.productId <= 0) {
      return res.status(400).json({ error: "each item needs a positive integer productId" });
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return res.status(400).json({ error: "each item needs a positive integer quantity" });
    }
    if (!Number.isInteger(item.unitPriceCents) || item.unitPriceCents < 0) {
      return res.status(400).json({ error: "each item needs an integer unitPriceCents >= 0" });
    }
    if (typeof item.name !== "string" || item.name.length === 0) {
      return res.status(400).json({ error: "each item needs a name" });
    }
  }
  const totalCents = items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
  const id = randomUUID();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("INSERT INTO orders (id, status, total_cents) VALUES (?, 'placed', ?)", [id, totalCents]);
    for (const item of items) {
      await conn.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)",
        [id, item.productId, item.quantity, item.unitPriceCents]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  const order = {
    id,
    status: "placed",
    totalCents,
    items: items.map(({ productId, quantity, name, unitPriceCents }) => ({ productId, quantity, name, unitPriceCents })),
  };
  if (ORDERS_TOPIC_ARN) {
    publishEvent(ORDERS_TOPIC_ARN, "order.placed", order).catch((err) =>
      console.error("failed to publish order.placed", err)
    );
  }
  res.status(201).json(order);
});

router.get("/:id", async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });
  res.json(order);
});

module.exports = router;
