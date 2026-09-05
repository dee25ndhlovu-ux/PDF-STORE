require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Paynow } = require("paynow");
const { watermarkPdf } = require("./watermark");
const { sendPdf } = require("./mailer");

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const DEMO_MODE = process.env.DEMO_MODE === "true";
const PRODUCTS_FILE = path.join(__dirname, "products.json");
const FILES_DIR = path.join(__dirname, "files");

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, "public")));

// ---------- Product catalogue ----------
function loadProducts() {
  return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
}
function saveProducts(list) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(list, null, 2));
}

// ---------- Orders (in memory; swap for a database in production) ----------
const orders = new Map(); // orderRef -> order

// ---------- Paynow ----------
function makePaynow() {
  const pn = new Paynow(process.env.PAYNOW_INTEGRATION_ID, process.env.PAYNOW_INTEGRATION_KEY);
  pn.resultUrl = `${BASE_URL}/api/paynow/result`;
  pn.returnUrl = `${BASE_URL}/?paid=1`;
  return pn;
}

// ---------- Fulfilment: watermark + email, exactly once per order ----------
async function fulfil(order) {
  if (order.status === "delivered" || order.fulfilling) return;
  order.fulfilling = true;
  try {
    const product = loadProducts().find((p) => p.id === order.productId);
    if (!product) throw new Error("Product no longer exists");

    const pdf = await watermarkPdf(path.join(FILES_DIR, product.file), {
      name: order.name,
      email: order.email,
      orderRef: order.ref,
      date: new Date().toISOString().slice(0, 10),
    });

    const result = await sendPdf({
      to: order.email,
      name: order.name,
      productTitle: product.title,
      orderRef: order.ref,
      pdfBuffer: pdf,
      fileName: product.file,
    });

    order.status = "delivered";
    order.deliveredAt = new Date().toISOString();
    order.emailPreview = result.preview; // only set in Ethereal test mode
    console.log(`[order ${order.ref}] delivered to ${order.email}`);
  } catch (err) {
    order.status = "delivery_failed";
    order.error = err.message;
    console.error(`[order ${order.ref}] delivery failed:`, err.message);
  } finally {
    order.fulfilling = false;
  }
}

// ---------- Public API ----------
app.get("/api/products", (req, res) => {
  const list = loadProducts().map(({ file, ...pub }) => pub); // never expose file paths
  res.json(list);
});

// Start a checkout: creates the order and sends the EcoCash prompt to the buyer's phone
app.post("/api/checkout", async (req, res) => {
  const { productId, name, email, phone } = req.body || {};
  const product = loadProducts().find((p) => p.id === productId);

  if (!product) return res.status(400).json({ error: "Product not found." });
  if (!name || !email || !phone) return res.status(400).json({ error: "Name, email and EcoCash number are required." });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (!/^0(77|78)\d{7}$/.test(phone.replace(/\s/g, ""))) return res.status(400).json({ error: "Enter a valid EcoCash number, e.g. 0771234567." });

  const ref = "ORD-" + crypto.randomBytes(4).toString("hex").toUpperCase();
  const order = {
    ref,
    productId,
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone: phone.replace(/\s/g, ""),
    amount: product.price,
    status: "pending",
    createdAt: new Date().toISOString(),
    pollUrl: null,
  };
  orders.set(ref, order);

  if (DEMO_MODE) {
    order.status = "paid";
    fulfil(order);
    return res.json({ ref, instructions: "Demo mode: payment simulated. Delivering your PDF now." });
  }

  try {
    const paynow = makePaynow();
    const payment = paynow.createPayment(ref, order.email);
    payment.add(product.title, product.price);
    const response = await paynow.sendMobile(payment, order.phone, "ecocash");

    if (!response || !response.success) {
      order.status = "failed";
      order.error = (response && response.error) || "Paynow rejected the request";
      return res.status(502).json({ error: `Payment could not be started: ${order.error}` });
    }
    order.pollUrl = response.pollUrl;
    res.json({ ref, instructions: response.instructions || "Check your phone and enter your EcoCash PIN to approve the payment." });
  } catch (err) {
    order.status = "failed";
    order.error = err.message;
    res.status(502).json({ error: `Payment could not be started: ${err.message}` });
  }
});

// The buyer's browser polls this until the order is delivered
app.get("/api/orders/:ref", async (req, res) => {
  const order = orders.get(req.params.ref);
  if (!order) return res.status(404).json({ error: "Order not found." });

  if (order.status === "pending" && order.pollUrl) {
    try {
      const status = await makePaynow().pollTransaction(order.pollUrl);
      if (status.paid()) {
        order.status = "paid";
        fulfil(order);
      } else if (/cancel|fail/i.test(status.status || "")) {
        order.status = "cancelled";
      }
    } catch (err) {
      console.error(`[order ${order.ref}] poll error:`, err.message);
    }
  }

  const { pollUrl, fulfilling, ...pub } = order;
  res.json(pub);
});

// Paynow also POSTs results here (server-to-server) as a backup to polling
app.post("/api/paynow/result", async (req, res) => {
  const { reference, status, hash } = req.body || {};
  res.sendStatus(200);
  const order = reference && orders.get(reference);
  if (!order || order.status !== "pending") return;

  // Verify the hash so nobody can fake a "Paid" message
  const fields = Object.entries(req.body).filter(([k]) => k !== "hash").map(([, v]) => v).join("");
  const expected = crypto.createHash("sha512").update(fields + process.env.PAYNOW_INTEGRATION_KEY).digest("hex").toUpperCase();
  if (expected !== String(hash).toUpperCase()) {
    console.warn(`[order ${reference}] result hash mismatch, ignored`);
    return;
  }
  if (/^paid$/i.test(status)) {
    order.status = "paid";
    fulfil(order);
  } else if (/cancel/i.test(status)) {
    order.status = "cancelled";
  }
});

// ---------- Admin: add products without touching code ----------
function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Basic\s+/i, "");
  const decoded = Buffer.from(token, "base64").toString();
  const pass = decoded.split(":")[1];
  if (process.env.ADMIN_PASSWORD && pass === process.env.ADMIN_PASSWORD) return next();
  res.set("WWW-Authenticate", 'Basic realm="admin"');
  res.status(401).send("Sign in required");
}

app.get("/admin", requireAdmin, (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/admin/products", requireAdmin, (req, res) => res.json(loadProducts()));
app.get("/api/admin/files", requireAdmin, (req, res) => {
  res.json(fs.readdirSync(FILES_DIR).filter((f) => f.toLowerCase().endsWith(".pdf")));
});
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  res.json([...orders.values()].map(({ pollUrl, fulfilling, ...o }) => o).reverse());
});

app.post("/api/admin/products", requireAdmin, (req, res) => {
  const { title, description, price, file } = req.body || {};
  if (!title || !file || !(price > 0)) return res.status(400).json({ error: "Title, price and file are required." });
  if (!fs.existsSync(path.join(FILES_DIR, file))) return res.status(400).json({ error: "That file is not in the files folder." });
  const list = loadProducts();
  const id = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
  list.push({ id, title, description: description || "", price: Number(price), file });
  saveProducts(list);
  res.json({ ok: true, id });
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  saveProducts(loadProducts().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`PDF store running on ${BASE_URL}${DEMO_MODE ? " (DEMO MODE: payments are simulated)" : ""}`);
});
