const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Server } = require("ws");
const Razorpay = require('razorpay');   // ✅ Razorpay SDK

const app = express();
app.use(bodyParser.json());

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

// --- Webhook route ---
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
        console.log("💰 Payment captured:", payment.id, "Amount:", amountRs);
        console.log("📦 Full payload:", JSON.stringify(payment, null, 2)); // extra logging for testing
        notifyESP32(amountRs); // 🔔 send to ESP32
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

function notifyESP32(amount) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(`CONFIRM:${amount}`);
    }
  });
}
