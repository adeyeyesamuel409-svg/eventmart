const statements = [
  `CREATE TABLE IF NOT EXISTS carts (
    id CHAR(36) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS cart_items (
    cart_id CHAR(36) NOT NULL,
    product_id BIGINT NOT NULL,
    quantity INT NOT NULL,
    PRIMARY KEY (cart_id, product_id),
    FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE
  )`,
];

async function migrate(pool) {
  for (const sql of statements) {
    await pool.query(sql);
  }
}

module.exports = { migrate };
