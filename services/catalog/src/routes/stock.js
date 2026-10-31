const express = require("express");
const { pool } = require("../db");

const router = express.Router();

function validateItems(body) {
  const { items } = body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return { error: "items must be a non-empty array" };
  }
  for (const item of items) {
    if (!item || !Number.isInteger(item.productId) || item.productId <= 0) {
      return { error: "each item needs a positive integer productId" };
    }
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      return { error: "each item needs a positive integer quantity" };
    }
  }
  return { items };
}

async function applyStockChange(items, delta) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const sorted = [...items].sort((a, b) => a.productId - b.productId);
    const snapshots = [];
    for (const { productId, quantity } of sorted) {
      const [rows] = await conn.query(
        "SELECT id, name, price_cents AS priceCents, stock FROM products WHERE id = ? FOR UPDATE",
        [productId]
      );
      if (rows.length === 0) {
        await conn.rollback();
        return { status: 404, body: { error: `product ${productId} not found` } };
      }
      const product = rows[0];
      if (delta < 0 && product.stock < quantity) {
        await conn.rollback();
        return { status: 409, body: { error: `insufficient stock for product ${productId}` } };
      }
      snapshots.push({ id: product.id, name: product.name, priceCents: product.priceCents, quantity });
    }
    for (const { productId, quantity } of sorted) {
      await conn.query("UPDATE products SET stock = stock + ? WHERE id = ?", [delta * quantity, productId]);
    }
    await conn.commit();
    return {
      status: 200,
      body: { items: snapshots.map(({ id, name, priceCents, quantity }) => ({ productId: id, name, priceCents, quantity })) },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

router.post("/decrement", async (req, res) => {
  const { items, error } = validateItems(req.body);
  if (error) return res.status(400).json({ error });
  const { status, body } = await applyStockChange(items, -1);
  res.status(status).json(body);
});

router.post("/increment", async (req, res) => {
  const { items, error } = validateItems(req.body);
  if (error) return res.status(400).json({ error });
  const { status, body } = await applyStockChange(items, 1);
  res.status(status).json(body);
});

module.exports = router;
