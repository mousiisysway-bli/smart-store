import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

// Dev: Vite proxies /api -> http://localhost:5000.  Production: same domain.
const API = import.meta.env.VITE_API_URL || "";
const PAGE_SIZE = 12;

const money = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function api(path, options) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("Cannot reach the server. Please make sure the backend is running.");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json */
  }
  if (!res.ok || !data?.success) {
    throw new Error(data?.message || `Request failed (${res.status})`);
  }
  return data;
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("smart-store-cart") || "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [cart, setCart] = useState(loadCart);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [toast, setToast] = useState("");

  async function loadProducts(showLoader = true) {
    try {
      if (showLoader) setLoading(true);
      setLoadError("");
      const data = await api("/api/products");
      setProducts(data.products || []);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("smart-store-cart", JSON.stringify(cart));
    } catch {
      /* ignore */
    }
  }, [cart]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [search, category]);

  const categories = useMemo(
    () => ["All", ...new Set(products.map((p) => p.category).filter(Boolean))],
    [products]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter(
      (p) =>
        (category === "All" || p.category === category) &&
        (!q || p.title.toLowerCase().includes(q) || (p.category || "").toLowerCase().includes(q))
    );
  }, [products, search, category]);

  const itemCount = cart.reduce((s, i) => s + i.quantity, 0);
  const total = cart.reduce((s, i) => s + Number(i.price) * i.quantity, 0);

  function qtyInCart(id) {
    return cart.find((i) => i.id === id)?.quantity || 0;
  }

  function addToCart(p) {
    const current = qtyInCart(p.id);
    if (current >= p.stock) {
      setToast(`Only ${p.stock} in stock`);
      return;
    }
    setCart((prev) =>
      current
        ? prev.map((i) => (i.id === p.id ? { ...i, quantity: i.quantity + 1, stock: p.stock } : i))
        : [
            ...prev,
            { id: p.id, title: p.title, price: Number(p.price), thumbnail: p.thumbnail, quantity: 1, stock: p.stock },
          ]
    );
    setToast(`${p.title} added to cart`);
  }

  function changeQty(id, delta) {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.id !== id) return i;
          const q = i.quantity + delta;
          if (delta > 0 && q > i.stock) {
            setToast(`Only ${i.stock} in stock`);
            return i;
          }
          return { ...i, quantity: q };
        })
        .filter((i) => i.quantity > 0)
    );
  }

  function removeItem(id) {
    setCart((prev) => prev.filter((i) => i.id !== id));
  }

  function openCheckout() {
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  return (
    <div className="app">
      {/* ---------- HEADER ---------- */}
      <header className="header">
        <div className="header-inner">
          <a className="logo" href="/">
            <span className="logo-icon">🛍️</span> Smart<span>Store</span>
          </a>

          <div className="search">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <button className="cart-btn" onClick={() => setCartOpen(true)} aria-label="Open cart">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6h15l-1.5 9h-12z" />
              <path d="M6 6 5 3H2" />
              <circle cx="9" cy="20" r="1.4" />
              <circle cx="18" cy="20" r="1.4" />
            </svg>
            <span className="cart-text">Cart</span>
            {itemCount > 0 && <span className="badge">{itemCount}</span>}
          </button>
        </div>
      </header>

      {/* ---------- HERO ---------- */}
      <section className="hero">
        <div className="hero-inner">
          <h1>Shop smart. Get it delivered.</h1>
          <p>Fresh deals every day. Verify your order with a quick email OTP and you're done.</p>
          <div className="hero-points">
            <span>✔ Secure email OTP</span>
            <span>✔ Live stock</span>
            <span>✔ Instant confirmation mail</span>
          </div>
        </div>
      </section>

      <main className="container">
        {/* ---------- CATEGORIES ---------- */}
        {categories.length > 1 && (
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className={`chip ${c === category ? "active" : ""}`} onClick={() => setCategory(c)}>
                {c === "All" ? "All" : c.replace(/-/g, " ")}
              </button>
            ))}
          </div>
        )}

        <div className="section-title">
          <h2>{category === "All" ? "Our Products" : category.replace(/-/g, " ")}</h2>
          {!loading && <span>{filtered.length} items</span>}
        </div>

        {/* ---------- PRODUCTS ---------- */}
        {loading ? (
          <div className="grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div className="card skeleton" key={i} />
            ))}
          </div>
        ) : loadError ? (
          <div className="state-box">
            <div className="state-emoji">😕</div>
            <h3>Couldn't load products</h3>
            <p>{loadError}</p>
            <button className="btn primary" onClick={() => loadProducts()}>
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="state-box">
            <div className="state-emoji">🔍</div>
            <h3>No products found</h3>
            <p>Try a different search or category.</p>
          </div>
        ) : (
          <>
            <div className="grid">
              {filtered.slice(0, visible).map((p) => {
                const inCart = qtyInCart(p.id);
                const out = p.stock <= 0;
                return (
                  <article className="card" key={p.id}>
                    <div className="card-img">
                      {out ? (
                        <span className="tag out">Out of stock</span>
                      ) : p.stock <= 10 ? (
                        <span className="tag low">Only {p.stock} left</span>
                      ) : null}
                      <img src={p.thumbnail} alt={p.title} loading="lazy" />
                    </div>
                    <div className="card-body">
                      <span className="cat">{(p.category || "").replace(/-/g, " ")}</span>
                      <h3>{p.title}</h3>
                      <div className="card-foot">
                        <div>
                          <div className="price">{money(p.price)}</div>
                          <div className={`stock ${out ? "bad" : p.stock <= 10 ? "warn" : ""}`}>
                            {out ? "Unavailable" : `${p.stock} in stock`}
                          </div>
                        </div>
                        {inCart > 0 ? (
                          <div className="stepper">
                            <button onClick={() => changeQty(p.id, -1)} aria-label="Decrease">
                              −
                            </button>
                            <span>{inCart}</span>
                            <button onClick={() => changeQty(p.id, 1)} aria-label="Increase">
                              +
                            </button>
                          </div>
                        ) : (
                          <button className="btn primary small" disabled={out} onClick={() => addToCart(p)}>
                            {out ? "Sold out" : "Add"}
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>

            {visible < filtered.length && (
              <div className="center">
                <button className="btn ghost" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                  Load more ({filtered.length - visible} more)
                </button>
              </div>
            )}
          </>
        )}
      </main>

      <footer className="footer">© {new Date().getFullYear()} Smart Store · Made with ❤️</footer>

      {/* ---------- CART DRAWER ---------- */}
      <div className={`backdrop ${cartOpen ? "show" : ""}`} onClick={() => setCartOpen(false)} />
      <aside className={`drawer ${cartOpen ? "open" : ""}`} aria-hidden={!cartOpen}>
        <div className="drawer-head">
          <h3>Your Cart ({itemCount})</h3>
          <button className="icon-btn" onClick={() => setCartOpen(false)} aria-label="Close cart">
            ✕
          </button>
        </div>

        {cart.length === 0 ? (
          <div className="state-box">
            <div className="state-emoji">🛒</div>
            <h3>Your cart is empty</h3>
            <p>Add something you like!</p>
          </div>
        ) : (
          <>
            <div className="drawer-items">
              {cart.map((i) => (
                <div className="cart-row" key={i.id}>
                  <img src={i.thumbnail} alt="" />
                  <div className="cart-info">
                    <strong>{i.title}</strong>
                    <span>{money(i.price)}</span>
                    <div className="stepper small">
                      <button onClick={() => changeQty(i.id, -1)}>−</button>
                      <span>{i.quantity}</span>
                      <button onClick={() => changeQty(i.id, 1)}>+</button>
                    </div>
                  </div>
                  <div className="cart-right">
                    <strong>{money(i.price * i.quantity)}</strong>
                    <button className="link-danger" onClick={() => removeItem(i.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="drawer-foot">
              <div className="total-row">
                <span>Total</span>
                <strong>{money(total)}</strong>
              </div>
              <button className="btn primary block" onClick={openCheckout}>
                Proceed to Checkout
              </button>
            </div>
          </>
        )}
      </aside>

      {checkoutOpen && (
        <Checkout
          cart={cart}
          total={total}
          onClose={() => setCheckoutOpen(false)}
          onDone={() => {
            setCart([]);
            loadProducts(false); // refresh so reduced stock is shown
          }}
        />
      )}

      <div className={`toast ${toast ? "show" : ""}`}>{toast}</div>
    </div>
  );
}

/* =====================================================================
   CHECKOUT  (details -> email OTP -> success)
   ===================================================================== */

function Checkout({ cart, total, onClose, onDone }) {
  const [step, setStep] = useState("details"); // details | otp | done
  const [customer, setCustomer] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("smart-store-customer")) || { name: "", email: "", phone: "", address: "" };
    } catch {
      return { name: "", email: "", phone: "", address: "" };
    }
  });
  const [digits, setDigits] = useState(Array(6).fill(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [order, setOrder] = useState(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  function onField(e) {
    setCustomer((c) => ({ ...c, [e.target.name]: e.target.value }));
  }

  async function sendOtp(e) {
    e?.preventDefault();
    setError("");
    const phoneOk = /^[+\d][\d\s-]{6,18}$/.test(customer.phone.trim());
    if (!phoneOk) return setError("Please enter a valid phone number");
    if (customer.address.trim().length < 8) return setError("Please enter your full delivery address");

    try {
      setBusy(true);
      await api("/api/send-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: customer.email, cart }),
      });
      try {
        localStorage.setItem("smart-store-customer", JSON.stringify(customer));
      } catch {
        /* ignore */
      }
      setDigits(Array(6).fill(""));
      setCooldown(30);
      setStep("otp");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e) {
    e?.preventDefault();
    const otp = digits.join("");
    if (otp.length !== 6) return setError("Please enter the 6-digit OTP");
    setError("");
    try {
      setBusy(true);
      const data = await api("/api/verify-email-otp", {
        method: "POST",
        body: JSON.stringify({ email: customer.email, otp, customer, cart }),
      });
      setOrder(data);
      setStep("done");
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const stepIndex = step === "details" ? 0 : step === "otp" ? 1 : 2;

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && step !== "otp" && onClose()}>
      <div className="modal">
        {step !== "done" && (
          <button className="icon-btn close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}

        <div className="steps">
          {["Details", "Verify", "Done"].map((s, i) => (
            <div key={s} className={`step ${i <= stepIndex ? "on" : ""}`}>
              <span>{i < stepIndex ? "✓" : i + 1}</span>
              {s}
            </div>
          ))}
        </div>

        {error && <div className="alert">{error}</div>}

        {step === "details" && (
          <form onSubmit={sendOtp}>
            <h2>Delivery details</h2>
            <label>
              Full name
              <input name="name" value={customer.name} onChange={onField} placeholder="Your name" required />
            </label>
            <label>
              Email (OTP will be sent here)
              <input name="email" type="email" value={customer.email} onChange={onField} placeholder="you@example.com" required />
            </label>
            <label>
              Phone number
              <input name="phone" type="tel" value={customer.phone} onChange={onField} placeholder="98765 43210" required />
            </label>
            <label>
              Delivery address
              <textarea name="address" rows="3" value={customer.address} onChange={onField} placeholder="House no, street, city, pincode" required />
            </label>

            <div className="summary">
              <span>
                {cart.reduce((s, i) => s + i.quantity, 0)} item(s) · Total
              </span>
              <strong>{money(total)}</strong>
            </div>

            <button className="btn primary block" disabled={busy}>
              {busy ? "Sending OTP..." : "Send Email OTP"}
            </button>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={verify}>
            <h2>Enter the OTP</h2>
            <p className="muted">
              We sent a 6-digit code to <strong>{customer.email}</strong>. It is valid for 5 minutes.
            </p>

            <OtpInput digits={digits} setDigits={setDigits} disabled={busy} onChange={() => setError("")} />

            <button className="btn primary block" disabled={busy || digits.join("").length !== 6}>
              {busy ? "Placing order..." : `Verify & Place Order · ${money(total)}`}
            </button>

            <div className="otp-links">
              <button type="button" className="link" onClick={() => { setError(""); setStep("details"); }}>
                ← Change details
              </button>
              <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={sendOtp}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend OTP"}
              </button>
            </div>
          </form>
        )}

        {step === "done" && order && (
          <div className="success">
            <div className="tick">
              <svg viewBox="0 0 52 52">
                <circle cx="26" cy="26" r="24" fill="none" />
                <path d="M14 27l8 8 16-17" fill="none" />
              </svg>
            </div>
            <h2>Order placed!</h2>
            <p className="muted">
              Thank you, {customer.name.split(" ")[0]}. A confirmation email has been sent to <strong>{customer.email}</strong>.
            </p>
            <div className="order-box">
              <div>
                <span>Order number</span>
                <strong>{order.orderNumber}</strong>
              </div>
              <div>
                <span>Amount</span>
                <strong>{money(order.total)}</strong>
              </div>
            </div>
            <button className="btn primary block" onClick={onClose}>
              Continue shopping
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function OtpInput({ digits, setDigits, disabled, onChange }) {
  const refs = useRef([]);

  function update(i, ch) {
    setDigits((d) => d.map((x, idx) => (idx === i ? ch : x)));
    onChange?.();
  }

  return (
    <div
      className="otp-boxes"
      onPaste={(e) => {
        const t = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
        if (!t) return;
        e.preventDefault();
        setDigits(Array.from({ length: 6 }, (_, i) => t[i] || ""));
        refs.current[Math.min(t.length, 5)]?.focus();
        onChange?.();
      }}
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          className="otp-box"
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={i === 0}
          onChange={(e) => {
            const ch = e.target.value.replace(/\D/g, "").slice(-1);
            update(i, ch);
            if (ch && i < 5) refs.current[i + 1]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowLeft" && i > 0) refs.current[i - 1]?.focus();
            if (e.key === "ArrowRight" && i < 5) refs.current[i + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
