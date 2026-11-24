const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS, // Gmail "App Password" (16 chars), not your normal password
  },
});

const FROM = `"Smart Store" <${process.env.EMAIL_USER}>`;
const money = (n) =>
  "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function shell(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#f4f5fb;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:520px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 6px 24px rgba(40,30,120,.12)">
    <div style="background:linear-gradient(135deg,#6d4aff,#ff7a45);padding:22px 28px;color:#fff;font-size:22px;font-weight:700">🛍️ Smart Store</div>
    <div style="padding:28px">
      <h2 style="margin:0 0 12px;color:#1c1b2e">${title}</h2>${body}
    </div>
    <div style="padding:14px 28px;background:#fafaff;color:#8a89a3;font-size:12px">This is an automated email from Smart Store.</div>
  </div></body></html>`;
}

async function sendOtpEmail(email, otp) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `${otp} is your Smart Store verification code`,
    text: `Your Smart Store OTP is ${otp}. It is valid for 5 minutes. Do not share it with anyone.`,
    html: shell(
      "Verify your order",
      `<p style="color:#555;margin:0 0 18px">Use this code to confirm your order. It is valid for <b>5 minutes</b>.</p>
       <div style="font-size:36px;letter-spacing:10px;font-weight:800;color:#6d4aff;background:#f1edff;border-radius:12px;padding:16px;text-align:center">${otp}</div>
       <p style="color:#999;font-size:13px;margin-top:18px">Never share this code with anyone.</p>`
    ),
  });
}

async function sendOrderEmail(email, order) {
  const rows = order.items
    .map(
      (i) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee">${esc(i.title)} × ${i.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right">${money(i.price * i.quantity)}</td></tr>`
    )
    .join("");
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Order confirmed – ${order.orderNumber}`,
    html: shell(
      "Thanks, your order is confirmed! 🎉",
      `<p style="color:#555;margin:0 0 4px">Hi ${esc(order.customerName)}, order number <b>${order.orderNumber}</b></p>
       <table style="width:100%;border-collapse:collapse;margin:16px 0;color:#333">${rows}
         <tr><td style="padding-top:12px;font-weight:700">Total</td><td style="padding-top:12px;text-align:right;font-weight:700;color:#6d4aff">${money(order.total)}</td></tr>
       </table>
       <p style="color:#555;margin:0"><b>Delivery address</b><br>${esc(order.address).replace(/\n/g, "<br>")}</p>`
    ),
  });
}

module.exports = { sendOtpEmail, sendOrderEmail };
