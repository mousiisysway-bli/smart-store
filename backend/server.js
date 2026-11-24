const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const db = require("./db");
const { sendOtpEmail, sendOrderEmail } = require("./email-otp");

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", 1);
app.use(
  cors({
    origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : true,
  })
);
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
  req.body = req.body || {};
  next();
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({
      success: false,
      message: status === 500 ? err.message || "Server error" : err.message,
    });
  });

// ---------------------------------------------------------------------------
// DATABASE SETUP (creates tables / missing columns automatically)
// ---------------------------------------------------------------------------

async function ensureColumn(table, column, ddl) {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS c FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (!rows[0].c) {
    await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
    console.log(`DB: added column ${table}.${column}`);
  }
}

async function ensureSchema() {
  await db.query(`CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL DEFAULT 0,
    stock INT NOT NULL DEFAULT 0,
    thumbnail VARCHAR(500)
  )`);
  await ensureColumn("products", "category", "VARCHAR(100) NULL");
  await ensureColumn("products", "description", "TEXT NULL");

  await db.query(`CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_number VARCHAR(50) NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    email VARCHAR(190) NULL,
    phone VARCHAR(30) NOT NULL,
    address TEXT NOT NULL,
    total DECIMAL(10,2) NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'Confirmed',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  await ensureColumn("orders", "email", "VARCHAR(190) NULL");
  await ensureColumn("orders", "created_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP");
  // old code used a status like "Pending OTP"; make sure any text fits
  await db.query("ALTER TABLE orders MODIFY status VARCHAR(50) NOT NULL DEFAULT 'Confirmed'").catch(() => {});

  await db.query(`CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    product_id INT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    quantity INT NOT NULL,
    price DECIMAL(10,2) NOT NULL
  )`);
}

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------

async function syncProducts() {
  const response = await fetch("https://dummyjson.com/products?limit=100");
  if (!response.ok) throw new Error("DummyJSON API failed");
  const data = await response.json();

  for (const p of data.products) {
    // NOTE: stock is only set on first insert, so stock reduced by orders is never reset.
    await db.query(
      `INSERT INTO products (id, title, price, stock, thumbnail, category, description)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         title = VALUES(title),
         price = VALUES(price),
         thumbnail = VALUES(thumbnail),
         category = VALUES(category),
         description = VALUES(description)`,
      [p.id, p.title, p.price, p.stock, p.thumbnail, p.category, p.description]
    );
  }
  return data.products.length;
}

// Works with GET (browser / old frontend) and POST
app.all(
  "/api/products/sync",
  wrap(async (req, res) => {
    if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "Method not allowed");
    const total = await syncProducts();
    res.json({ success: true, message: "Products synced successfully", total });
  })
);

app.get(
  "/api/products",
  wrap(async (req, res) => {
    const [[{ c }]] = await db.query("SELECT COUNT(*) AS c FROM products");
    if (c === 0) await syncProducts().catch((e) => console.error("Auto-sync failed:", e.message));
    const [products] = await db.query(
      "SELECT id, title, description, category, price, stock, thumbnail FROM products ORDER BY id"
    );
    res.json({ success: true, products });
  })
);

app.get(
  "/api/products/:id",
  wrap(async (req, res) => {
    const [rows] = await db.query("SELECT * FROM products WHERE id = ?", [req.params.id]);
    if (!rows.length) throw new HttpError(404, "Product not found");
    res.json({ success: true, product: rows[0] });
  })
);

app.get("/api/health", (req, res) => res.json({ success: true, message: "Smart Store Backend is Running!" }));

app.get(
  "/api/test",
  wrap(async (req, res) => {
    const [rows] = await db.query("SELECT 1 AS result");
    res.json({ success: true, message: "MySQL connected successfully", data: rows });
  })
);

// ---------------------------------------------------------------------------
// CART VALIDATION (prices & stock always come from the database)
// ---------------------------------------------------------------------------

function normalizeCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0) throw new HttpError(400, "Your cart is empty");
  const merged = new Map();
  for (const item of cart) {
    const id = Number(item.id ?? item.product_id);
    const qty = Number(item.quantity);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty <= 0 || qty > 100) {
      throw new HttpError(400, "Invalid product or quantity in cart");
    }
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  return [...merged.entries()].sort((a, b) => a[0] - b[0]); // sorted ids -> no deadlocks
}

async function checkStock(cart) {
  for (const [id, qty] of normalizeCart(cart)) {
    const [rows] = await db.query("SELECT title, stock FROM products WHERE id = ?", [id]);
    if (!rows.length) throw new HttpError(400, "A product in your cart no longer exists");
    if (rows[0].stock < qty) {
      throw new HttpError(
        409,
        rows[0].stock === 0
          ? `${rows[0].title} is out of stock`
          : `Only ${rows[0].stock} left for ${rows[0].title}`
      );
    }
  }
}

async function placeOrder(customer, cart) {
  const entries = normalizeCart(cart);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    let total = 0;
    const items = [];

    for (const [id, qty] of entries) {
      const [rows] = await connection.query(
        "SELECT id, title, price, stock FROM products WHERE id = ? FOR UPDATE",
        [id]
      );
      if (!rows.length) throw new HttpError(400, "A product in your cart no longer exists");
      const p = rows[0];
      if (p.stock < qty) {
        throw new HttpError(
          409,
          p.stock === 0 ? `${p.title} is out of stock` : `Only ${p.stock} left for ${p.title}`
        );
      }
      // >>> STOCK REDUCTION <<<
      await connection.query("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, id]);

      const price = Number(p.price);
      total += price * qty;
      items.push({ product_id: p.id, title: p.title, price, quantity: qty });
    }
    total = Math.round(total * 100) / 100;

    const orderNumber = "ORD-" + Date.now() + crypto.randomInt(100, 999);
    const [result] = await connection.query(
      `INSERT INTO orders (order_number, customer_name, email, phone, address, total, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Confirmed')`,
      [orderNumber, customer.name, customer.email, customer.phone, customer.address, total]
    );

    for (const i of items) {
      await connection.query(
        `INSERT INTO order_items (order_id, product_id, product_name, quantity, price)
         VALUES (?, ?, ?, ?, ?)`,
        [result.insertId, i.product_id, i.title, i.quantity, i.price]
      );
    }

    await connection.commit();
    return { orderId: result.insertId, orderNumber, total, items };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
}

// ---------------------------------------------------------------------------
// EMAIL OTP
// ---------------------------------------------------------------------------

const OTP_TTL = 5 * 60 * 1000; // 5 minutes
const OTP_RESEND_GAP = 30 * 1000; // 30 seconds
const OTP_MAX_ATTEMPTS = 5;
const SECRET = process.env.OTP_SECRET || crypto.randomBytes(24).toString("hex");
const otpStore = new Map(); // email -> { hash, expires, attempts, lastSent, busy }
const ipHits = new Map(); // ip -> [timestamps]

const hashOtp = (email, otp) =>
  crypto.createHash("sha256").update(`${email}:${otp}:${SECRET}`).digest("hex");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of otpStore) if (v.expires < now) otpStore.delete(k);
  for (const [k, v] of ipHits) {
    const fresh = v.filter((t) => now - t < 3600e3);
    fresh.length ? ipHits.set(k, fresh) : ipHits.delete(k);
  }
}, 60e3).unref();

app.post(
  "/api/send-email-otp",
  wrap(async (req, res) => {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Please enter a valid email address");

    // max 10 OTP mails per IP per hour
    const now = Date.now();
    const hits = (ipHits.get(req.ip) || []).filter((t) => now - t < 3600e3);
    if (hits.length >= 10) throw new HttpError(429, "Too many OTP requests. Please try again later.");

    const existing = otpStore.get(email);
    if (existing && now - existing.lastSent < OTP_RESEND_GAP) {
      const wait = Math.ceil((OTP_RESEND_GAP - (now - existing.lastSent)) / 1000);
      throw new HttpError(429, `Please wait ${wait}s before requesting a new OTP`);
    }

    // check stock first so customer doesn't verify an order that can't be placed
    if (req.body.cart) await checkStock(req.body.cart);

    const otp = crypto.randomInt(100000, 1000000).toString();
    try {
      await sendOtpEmail(email, otp);
    } catch (e) {
      console.error("Email send failed:", e.message);
      throw new HttpError(502, "Could not send the OTP email. Please check the email address and try again.");
    }

    otpStore.set(email, { hash: hashOtp(email, otp), expires: now + OTP_TTL, attempts: 0, lastSent: now, busy: false });
    hits.push(now);
    ipHits.set(req.ip, hits);

    res.json({ success: true, message: "OTP sent to your email", expiresInSeconds: OTP_TTL / 1000 });
  })
);

app.post(
  "/api/verify-email-otp",
  wrap(async (req, res) => {
    const { otp, customer = {}, cart } = req.body;
    const email = String(req.body.email || customer.email || "").trim().toLowerCase();

    const name = String(customer.name || "").trim();
    const phone = String(customer.phone || "").trim();
    const address = String(customer.address || "").trim();
    if (!name || name.length > 150) throw new HttpError(400, "Please enter your name");
    if (!/^[+\d][\d\s-]{6,18}$/.test(phone)) throw new HttpError(400, "Please enter a valid phone number");
    if (address.length < 8 || address.length > 500) throw new HttpError(400, "Please enter your full delivery address");

    const record = otpStore.get(email);
    if (!record) throw new HttpError(400, "OTP not found. Please request a new OTP.");
    if (record.expires < Date.now()) {
      otpStore.delete(email);
      throw new HttpError(400, "OTP expired. Please request a new OTP.");
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      otpStore.delete(email);
      throw new HttpError(429, "Too many wrong attempts. Please request a new OTP.");
    }
    if (record.busy) throw new HttpError(409, "Your order is already being processed");

    const given = Buffer.from(hashOtp(email, String(otp || "").trim()));
    const real = Buffer.from(record.hash);
    if (!crypto.timingSafeEqual(given, real)) {
      record.attempts += 1;
      const left = OTP_MAX_ATTEMPTS - record.attempts;
      throw new HttpError(400, left > 0 ? `Wrong OTP. ${left} attempt(s) left.` : "Too many wrong attempts. Please request a new OTP.");
    }

    record.busy = true;
    try {
      const order = await placeOrder({ name, email, phone, address }, cart);
      otpStore.delete(email); // OTP is single-use

      // Confirmation mail (failure here must NOT fail the order)
      sendOrderEmail(email, {
        orderNumber: order.orderNumber,
        customerName: name,
        address,
        total: order.total,
        items: order.items,
      }).catch((e) => console.error("Confirmation email failed:", e.message));

      res.json({
        success: true,
        message: "Order placed successfully",
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        total: order.total,
      });
    } finally {
      record.busy = false;
    }
  })
);

app.use("/api", (req, res) => res.status(404).json({ success: false, message: "API route not found" }));

// ---------------------------------------------------------------------------
// SERVE THE BUILT FRONTEND (npm run build) -> one https link in production
// ---------------------------------------------------------------------------

const dist = path.join(__dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    res.sendFile(path.join(dist, "index.html"));
  });
} else {
  app.get("/", (req, res) => res.send("Smart Store Backend is Running! (run `npm run build` to serve the website here)"));
}

// ---------------------------------------------------------------------------

(async () => {
  try {
    await ensureSchema();
    console.log("MySQL connected & tables ready ✔");
  } catch (err) {
    console.error("Database setup error:", err.message);
  }
  app.listen(PORT, () => console.log(`Smart Store running at http://localhost:${PORT}`));
})();
