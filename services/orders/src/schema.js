const statements = [
  `CREATE TABLE IF NOT EXISTS orders (
    id CHAR(36) PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'placed',
    total_cents INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id CHAR(36) NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    unit_price_cents INT NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  )`,
];

async function migrate(pool) {
  for (const sql of statements) {
    await pool.query(sql);
  }
}

module.exports = { migrate };
