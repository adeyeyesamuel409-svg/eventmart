const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const SELECT = "SELECT id, sku, name, price_cents AS priceCents, stock, created_at AS createdAt FROM products";

router.get("/", async (req, res) => {
  const [rows] = await pool.query(`${SELECT} ORDER BY id`);
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { sku, name, priceCents, stock = 0 } = req.body || {};
  if (!sku || !name) {
    return res.status(400).json({ error: "sku and name are required" });
  }
  if (!Number.isInteger(priceCents) || priceCents < 0) {
    return res.status(400).json({ error: "priceCents must be an integer >= 0" });
  }
  if (!Number.isInteger(stock) || stock < 0) {
    return res.status(400).json({ error: "stock must be an integer >= 0" });
  }
  const [result] = await pool.query(
    "INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)",
    [sku, name, priceCents, stock]
  );
  const [rows] = await pool.query(`${SELECT} WHERE id = ?`, [result.insertId]);
  res.status(201).json(rows[0]);
});

router.post("/lookup", async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return res.status(400).json({ error: "ids must be a non-empty array of positive integers" });
  }
  const [rows] = await pool.query(`${SELECT} WHERE id IN (?)`, [ids]);
  res.json(rows);
});

router.get("/:id", async (req, res) => {
  const [rows] = await pool.query(`${SELECT} WHERE id = ?`, [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "product not found" });
  res.json(rows[0]);
});

router.patch("/:id", async (req, res) => {
  const { name, priceCents, stock } = req.body || {};
  if (name === undefined && priceCents === undefined && stock === undefined) {
    return res.status(400).json({ error: "nothing to update" });
  }
  if (priceCents !== undefined && (!Number.isInteger(priceCents) || priceCents < 0)) {
    return res.status(400).json({ error: "priceCents must be an integer >= 0" });
  }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
    return res.status(400).json({ error: "stock must be an integer >= 0" });
  }
  const [result] = await pool.query(
    "UPDATE products SET name = COALESCE(?, name), price_cents = COALESCE(?, price_cents), stock = COALESCE(?, stock) WHERE id = ?",
    [name ?? null, priceCents ?? null, stock ?? null, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: "product not found" });
  const [rows] = await pool.query(`${SELECT} WHERE id = ?`, [req.params.id]);
  res.json(rows[0]);
});

module.exports = router;
