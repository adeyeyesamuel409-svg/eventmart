const express = require("express");
const { pool } = require("../db");

const router = express.Router();

const SELECT = "SELECT id, order_id AS orderId, status, amount_cents AS amountCents, created_at AS createdAt FROM payments";

router.get("/", async (req, res) => {
  const [rows] = await pool.query(`${SELECT} ORDER BY created_at DESC`);
  res.json(rows);
});

router.get("/:orderId", async (req, res) => {
  const [rows] = await pool.query(`${SELECT} WHERE order_id = ?`, [req.params.orderId]);
  if (rows.length === 0) return res.status(404).json({ error: "payment not found" });
  res.json(rows[0]);
});

module.exports = router;
