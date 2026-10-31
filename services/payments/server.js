const { randomUUID } = require("node:crypto");
const express = require("express");
const { init, pool } = require("./src/db");
const { publishEvent, startEventConsumer } = require("./src/events");
const paymentsRouter = require("./src/routes/payments");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "eventmart-payments",
    status: "ok",
    description: "EventMart payments service - payment processing from order.placed events",
    endpoints: {
      payments: ["/payments", "/payments/:orderId"],
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/payments", paymentsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "route not found" });
});

app.use((err, req, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const port = process.env.PORT || 3000;
const PAYMENTS_QUEUE_URL = process.env.PAYMENTS_QUEUE_URL || "";
const PAYMENTS_TOPIC_ARN = process.env.PAYMENTS_TOPIC_ARN || "";

async function handleOrderPlaced(event) {
  const order = event.data;
  const [existing] = await pool.query("SELECT id, status FROM payments WHERE order_id = ?", [order.id]);
  if (existing.length > 0) {
    console.log(`payment for order ${order.id} already exists (${existing[0].status}), skipping`);
    return;
  }
  const succeeded = order.totalCents <= 100000;
  const status = succeeded ? "succeeded" : "failed";
  const payment = {
    id: randomUUID(),
    orderId: order.id,
    status,
    amountCents: order.totalCents,
  };
  await pool.query("INSERT INTO payments (id, order_id, status, amount_cents) VALUES (?, ?, ?, ?)", [
    payment.id,
    payment.orderId,
    payment.status,
    payment.amountCents,
  ]);
  console.log(`payment ${payment.status} for order ${order.id} (${payment.amountCents} cents)`);
  if (PAYMENTS_TOPIC_ARN) {
    await publishEvent(PAYMENTS_TOPIC_ARN, `payment.${succeeded ? "succeeded" : "failed"}`, payment);
  }
}

init()
  .then(() => {
    if (PAYMENTS_QUEUE_URL) {
      startEventConsumer(PAYMENTS_QUEUE_URL, async (event) => {
        if (event.eventType === "order.placed") {
          await handleOrderPlaced(event);
        }
      });
      console.log("consuming order events from", PAYMENTS_QUEUE_URL);
    }
    app.listen(port, () => {
      console.log(`eventmart-payments is ready and listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("failed to start", err);
    process.exit(1);
  });

module.exports = app;
