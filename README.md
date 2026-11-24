# Smart Store

React (Vite) + Node/Express + MySQL.  Customer places order -> **email OTP** -> order saved -> **stock reduced** -> confirmation email.

## 1. First time setup
1. Start MySQL (XAMPP) and create an empty database called `smart_store` in phpMyAdmin.
   (Tables are created automatically when the server starts.)
2. Copy `backend/.env.example` to `backend/.env` and fill EMAIL_USER / EMAIL_PASS (Gmail App Password) and DB_* values.
3. Install:
   ```
   npm install
   cd backend && npm install
   ```

## 2. Run (development)
Two terminals:
```
cd backend && npm run dev     # http://localhost:5000
npm run dev                   # http://localhost:5173
```

## 3. Get an https link
### A) Quick link (your PC must stay on) – Cloudflare Tunnel
```
npm run build
cd backend && npm start
cloudflared tunnel --url http://localhost:5000     # prints https://xxxx.trycloudflare.com
```
### B) Permanent link – Render + cloud MySQL
* Push this folder to GitHub.
* Create a free MySQL (Aiven / TiDB Cloud / Railway) and note host, port, user, password, db name.
* Render -> New Web Service -> your repo:
  * Build command: `npm install --include=dev && npm run build && cd backend && npm install`
  * Start command: `node backend/server.js`
  * Environment: EMAIL_USER, EMAIL_PASS, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL=true
* Render gives you `https://your-app.onrender.com`.

## API
| Method | Route | What |
|---|---|---|
| GET | /api/products | list products |
| GET/POST | /api/products/sync | import products from DummyJSON |
| POST | /api/send-email-otp | `{email, cart}` -> sends OTP mail |
| POST | /api/verify-email-otp | `{email, otp, customer, cart}` -> verifies, places order, reduces stock |
