// Sends the watermarked PDF to the buyer.
// If SMTP_* env vars are blank, uses a free Ethereal test inbox: nothing is really
// delivered, but a preview URL is printed in the server logs so you can see the email.

const nodemailer = require("nodemailer");

let transporterPromise = null;
let usingEthereal = false;

async function getTransporter() {
  if (transporterPromise) return transporterPromise;

  transporterPromise = (async () => {
    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
    try {
      const test = await nodemailer.createTestAccount();
      usingEthereal = true;
      console.log("[mail] No SMTP configured. Using Ethereal test inbox:", test.user);
      return nodemailer.createTransport({
        host: test.smtp.host,
        port: test.smtp.port,
        secure: test.smtp.secure,
        auth: { user: test.user, pass: test.pass },
      });
    } catch (err) {
      console.log("[mail] Ethereal unavailable, emails will be logged only:", err.message);
      return nodemailer.createTransport({ jsonTransport: true });
    }
  })();

  return transporterPromise;
}

async function sendPdf({ to, name, productTitle, orderRef, pdfBuffer, fileName }) {
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: process.env.FROM_EMAIL || "PDF Store <no-reply@example.com>",
    to,
    subject: `Your copy of ${productTitle} (order ${orderRef})`,
    text: [
      `Hello ${name},`,
      ``,
      `Thank you for your purchase. Your copy of "${productTitle}" is attached.`,
      ``,
      `This copy is licensed to you personally and is marked with your name, email and order reference on every page. Please do not share it.`,
      ``,
      `Order reference: ${orderRef}`,
    ].join("\n"),
    attachments: [{ filename: fileName, content: pdfBuffer, contentType: "application/pdf" }],
  });

  const preview = usingEthereal ? nodemailer.getTestMessageUrl(info) : null;
  if (preview) console.log(`[mail] Preview of email to ${to}: ${preview}`);
  return { messageId: info.messageId, preview };
}

module.exports = { sendPdf };
