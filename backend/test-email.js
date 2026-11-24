// Run:  node test-email.js your@email.com
const { sendOtpEmail } = require("./email-otp");

sendOtpEmail(process.argv[2] || process.env.EMAIL_USER, "123456")
  .then(() => console.log("Test email sent ✔"))
  .catch((e) => console.log("Failed to send email:", e.message));
