const express = require("express");
const { init } = require("./src/db");
const cartsRouter = require("./src/routes/carts");

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "eventmart-cart",
    status: "ok",
    description: "EventMart cart service - carts and checkout orchestration",
    endpoints: {
      carts: ["/carts", "/carts/:id", "/carts/:id/items", "/carts/:id/checkout"],
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/carts", cartsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "route not found" });
});

app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "invalid JSON body" });
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
      console.log(`eventmart-cart is ready and listening on port ${port}`);
    });
  })
  .catch((err) => {
    console.error("failed to start", err);
    process.exit(1);
  });

module.exports = app;
