const { randomUUID } = require("node:crypto");
const express = require("express");
const { pool } = require("../db");

const router = express.Router();

async function loadCart(cartId) {
  const [carts] = await pool.query("SELECT id, created_at AS createdAt FROM carts WHERE id = ?", [cartId]);
  if (carts.length === 0) return null;
  const [items] = await pool.query(
    `SELECT ci.product_id AS productId, ci.quantity, p.name, p.price_cents AS priceCents
     FROM cart_items ci JOIN products p ON p.id = ci.product_id
     WHERE ci.cart_id = ? ORDER BY ci.product_id`,
    [cartId]
  );
  const subtotalCents = items.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);
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
  const [products] = await pool.query("SELECT id FROM products WHERE id = ?", [productId]);
  if (products.length === 0) return res.status(400).json({ error: "productId does not exist" });
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
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [items] = await conn.query(
      `SELECT ci.product_id AS productId, ci.quantity, p.name, p.price_cents AS priceCents, p.stock
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
       WHERE ci.cart_id = ? FOR UPDATE`,
      [cartId]
    );
    if (items.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "cart not found or empty" });
    }
    for (const item of items) {
      if (item.stock < item.quantity) {
        await conn.rollback();
        return res.status(409).json({ error: `insufficient stock for product ${item.productId}` });
      }
    }
    const totalCents = items.reduce((sum, item) => sum + item.quantity * item.priceCents, 0);
    const orderId = randomUUID();
    await conn.query("INSERT INTO orders (id, status, total_cents) VALUES (?, 'placed', ?)", [orderId, totalCents]);
    for (const item of items) {
      await conn.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_cents) VALUES (?, ?, ?, ?)",
        [orderId, item.productId, item.quantity, item.priceCents]
      );
      await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [item.quantity, item.productId]);
    }
    await conn.query("DELETE FROM cart_items WHERE cart_id = ?", [cartId]);
    await conn.commit();
    res.status(201).json({
      id: orderId,
      status: "placed",
      totalCents,
      items: items.map(({ productId, quantity, name, priceCents }) => ({ productId, quantity, name, unitPriceCents: priceCents })),
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
});

module.exports = router;
