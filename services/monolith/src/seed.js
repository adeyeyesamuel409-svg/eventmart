const mysql = require("mysql2/promise");
const { migrate } = require("./schema");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "eventmart",
  password: process.env.DB_PASSWORD || "eventmart",
  database: process.env.DB_NAME || "eventmart",
});

const products = [
  { sku: "BOOK-001", name: "Cloud Engineering Handbook", priceCents: 3999, stock: 12 },
  { sku: "MUG-001", name: "EventMart Ops Mug", priceCents: 1250, stock: 30 },
  { sku: "STICKER-001", name: "Zero-Downtime Sticker Pack", priceCents: 499, stock: 100 },
];

(async () => {
  await migrate(pool);
  for (const p of products) {
    await pool.query(
      "INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)",
      [p.sku, p.name, p.priceCents, p.stock]
    );
    console.log(`seeded ${p.sku}`);
  }
  await pool.end();
})();
