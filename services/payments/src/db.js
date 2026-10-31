const mysql = require("mysql2/promise");
const { migrate } = require("./schema");

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "eventmart",
  password: process.env.DB_PASSWORD || "eventmart",
  database: process.env.DB_NAME || "eventmart",
  connectionLimit: 10,
  waitForConnections: true,
});

async function connectWithRetry(attempts = 30, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`waiting for database... (${i}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function init() {
  await connectWithRetry();
  await migrate(pool);
  console.log("database ready");
}

module.exports = { pool, init };
