const express = require("express");
const { init, pool } = require("./src/db");
const { startEventConsumer } = require("./src/events");
const ordersRouter = require("./src/routes/orders");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "eventmart-orders",
    status: "ok",
    description: "EventMart orders service - order creation and queries",
    endpoints: {
      orders: ["/orders", "/orders/:id"],
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/orders", ordersRouter);

app.use((req, res) => {
  res.status(404).json({ error: "route not found" });
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON body" });
  }
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(409).json({ error: "resource already exists" });
  }
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const port = process.env.PORT || 3000;

const ORDERS_QUEUE_URL = process.env.ORDERS_QUEUE_URL || "";

init()
  .then(() => {
    if (ORDERS_QUEUE_URL) {
      startEventConsumer(ORDERS_QUEUE_URL, async (event) => {
        if (event.eventType === "payment.succeeded") {
          await pool.query("UPDATE orders SET status = 'paid' WHERE id = ?", [event.data.orderId]);
          console.log(`order ${event.data.orderId} marked paid`);
        } else if (event.eventType === "payment.failed") {
          await pool.query("UPDATE orders SET status = 'payment_failed' WHERE id = ?", [event.data.orderId]);
          console.log(`order ${event.data.orderId} marked payment_failed`);
        }
      });
      console.log("consuming payment events from", ORDERS_QUEUE_URL);
    }
    app.listen(port, () => {
      console.log(`eventmart-orders is ready and listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("failed to start", err);
    process.exit(1);
  });

module.exports = app;
