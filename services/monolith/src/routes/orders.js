const express = require("express");
const { pool } = require("../db");

const router = express.Router();

async function loadOrder(orderId) {
  const [orders] = await pool.query(
    "SELECT id, status, total_cents AS totalCents, created_at AS createdAt FROM orders WHERE id = ?",
    [orderId]
  );
  if (orders.length === 0) return null;
  const [items] = await pool.query(
    `SELECT oi.product_id AS productId, oi.quantity, oi.unit_price_cents AS unitPriceCents, p.name
     FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ? ORDER BY oi.id`,
    [orderId]
  );
  return { ...orders[0], items };
}

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, status, total_cents AS totalCents, created_at AS createdAt FROM orders ORDER BY created_at DESC"
  );
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const order = await loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: "order not found" });
  res.json(order);
});

module.exports = router;
