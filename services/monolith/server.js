const express = require("express");
const { init } = require("./src/db");
const productsRouter = require("./src/routes/products");
const cartsRouter = require("./src/routes/carts");
const ordersRouter = require("./src/routes/orders");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "eventmart-monolith",
    phase: 1,
    status: "ok",
    description: "EventMart orders monolith (catalog + cart + orders)",
    endpoints: {
      products: ["/products", "/products/:id"],
      carts: ["/carts", "/carts/:id", "/carts/:id/items", "/carts/:id/checkout"],
      orders: ["/orders", "/orders/:id"],
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/products", productsRouter);
app.use("/carts", cartsRouter);
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
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

const port = process.env.PORT || 3000;

init()
  .then(() => {
    app.listen(port, () => {
      console.log(`eventmart-monolith is ready and listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("failed to start", err);
    process.exit(1);
  });

module.exports = app;
