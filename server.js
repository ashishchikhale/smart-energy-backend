const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Server } = require("ws");
const Razorpay = require('razorpay');
const QRCode = require('qrcode');   // ✅ For QR generation

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // for form submissions

// Razorpay credentials from environment variables
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// --- Root route for testing ---
app.get('/', (req, res) => {
  res.send('Smart Energy Backend is running on Render!');
});

// --- Razorpay instance ---
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// --- Payment form route ---
app.get('/pay', (req, res) => {
  res.send(`
    <form action="/create-payment" method="post">
      <label>Enter Amount (₹):</label>
      <input type="number" name="amount" required />
      <button type="submit">Generate Payment</button>
    </form>
  `);
});

// --- Create payment link + QR (simplified, no callback URL) ---
app.post('/create-payment', async (req, res) => {
  try {
    const amount = parseInt(req.body.amount) * 100; // Rs → paise
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).send("Invalid amount");
    }

    const paymentLink = await razorpay.paymentLink.create({
      amount,
      currency: "INR",
      description: "Smart Energy Meter Recharge"
    });

    const qrDataUrl = await QRCode.toDataURL(paymentLink.short_url);

    res.send(`
      <h2>Scan QR or click link to pay</h2>
      <img src="${qrDataUrl}" />
      <p><a href="${paymentLink.short_url}" target="_blank">Pay Now</a></p>
    `);
  } catch (err) {
    console.error("⚠️ Payment link error:", err);
    res.status(500).send("Error creating payment link: " + err.message);
  }
});

// --- Webhook route (keep for later when you add callback back) ---
app.post('/razorpay/webhook', (req, res) => {
  try {
    const body = JSON.stringify(req.body);
    const signature = req.headers['x-razorpay-signature'];

    const expectedSignature = crypto
      .createHmac('sha256', WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    if (signature === expectedSignature) {
      console.log("✅ Webhook verified:", req.body.event);

      if (req.body.event === "payment.captured") {
        const payment = req.body.payload.payment.entity;
        const amountRs = payment.amount / 100; // paise → Rs

        const UNIT_PRICE = 10; // Rs per unit
        const units = Math.floor(amountRs / UNIT_PRICE);

        console.log("💰 Payment captured:", payment.id, "Amount:", amountRs);
        console.log("🔋 Units to add:", units);

        notifyESP32(units); // send units to ESP32
      }
      res.status(200).send("OK");
    } else {
      console.warn("❌ Invalid signature!");
      res.status(400).send("Invalid signature");
    }
  } catch (err) {
    console.error("⚠️ Webhook error:", err);
    res.status(500).send("Server error");
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// --- WebSocket server attached to Express ---
const wss = new Server({ server });

wss.on("connection", ws => {
  console.log("🔌 ESP32 connected via WebSocket");
  ws.on("message", msg => console.log("ESP32 says:", msg));
});

function notifyESP32(units) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(`UNITS:${units}`);
    }
  });
}
