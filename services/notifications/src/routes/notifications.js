const express = require("express");
const { pool } = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, event_id AS eventId, event_type AS eventType, subject, body, created_at AS createdAt FROM notifications ORDER BY id DESC"
  );
  res.json(rows);
});

module.exports = router;
