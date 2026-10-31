const express = require("express");
const { init } = require("./src/db");
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

init()
  .then(() => {
    app.listen(port, () => {
      console.log(`eventmart-orders is ready and listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("failed to start", err);
    process.exit(1);
  });

module.exports = app;
