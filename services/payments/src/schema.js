const statements = [
  `CREATE TABLE IF NOT EXISTS payments (
    id CHAR(36) PRIMARY KEY,
    order_id CHAR(36) NOT NULL UNIQUE,
    status VARCHAR(32) NOT NULL,
    amount_cents INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
];

async function migrate(pool) {
  for (const sql of statements) {
    await pool.query(sql);
  }
}

module.exports = { migrate };
