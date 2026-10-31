const express = require("express");
const { init, pool } = require("./src/db");
const { startEventConsumer } = require("./src/events");
const notificationsRouter = require("./src/routes/notifications");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "eventmart-notifications",
    status: "ok",
    description: "EventMart notifications service - consumes domain events and sends notifications",
    endpoints: {
      notifications: ["/notifications"],
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/notifications", notificationsRouter);

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
const NOTIFICATIONS_QUEUE_URL = process.env.NOTIFICATIONS_QUEUE_URL || "";

function buildNotification(event) {
  const data = event.data;
  switch (event.eventType) {
    case "order.placed": {
      const items = (data.items || []).map((item) => `${item.quantity}x ${item.name}`).join(", ");
      return {
        subject: `Order ${data.id} placed`,
        body: `We received your order ${data.id} for ${data.totalCents} cents: ${items}`,
      };
    }
    case "payment.succeeded":
      return {
        subject: `Payment received for order ${data.orderId}`,
        body: `Payment ${data.id} of ${data.amountCents} cents for order ${data.orderId} succeeded`,
      };
    case "payment.failed":
      return {
        subject: `Payment failed for order ${data.orderId}`,
        body: `Payment ${data.id} of ${data.amountCents} cents for order ${data.orderId} failed`,
      };
    default:
      return null;
  }
}

async function handleEvent(event) {
  const notification = buildNotification(event);
  if (!notification) return;
  try {
    await pool.query(
      "INSERT INTO notifications (event_id, event_type, subject, body) VALUES (?, ?, ?, ?)",
      [event.eventId, event.eventType, notification.subject, notification.body]
    );
    console.log(`notified: ${notification.subject}`);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.log(`notification for event ${event.eventId} already sent, skipping`);
      return;
    }
    throw err;
  }
}

init()
  .then(() => {
    if (NOTIFICATIONS_QUEUE_URL) {
      startEventConsumer(NOTIFICATIONS_QUEUE_URL, handleEvent);
      console.log("consuming domain events from", NOTIFICATIONS_QUEUE_URL);
    }
    app.listen(port, () => {
      console.log(`eventmart-notifications is ready and listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("failed to start", err);
    process.exit(1);
  });

module.exports = app;
