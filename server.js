
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Server } = require("ws");
const Razorpay = require('razorpay');
const QRCode = require('qrcode');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ---------------- ENV ----------------
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID;
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

// ---------------- ROOT ----------------
app.get('/', (req, res) => {
  res.send('✅ Smart Energy Backend Running');
});

// ---------------- RAZORPAY ----------------
const razorpay = new Razorpay({
  key_id: RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET,
});

// ---------------- PAYMENT ROUTE ----------------
app.get('/create-payment', async (req, res) => {
  try {
    const amountRs = parseInt(req.query.amount);

    if (isNaN(amountRs) || amountRs <= 0) {
      return res.status(400).send("Invalid amount");
    }

    const paymentLink = await razorpay.paymentLink.create({
      amount: amountRs * 100,
      currency: "INR",
      description: "Smart Energy Meter Recharge"
    });

    const qrDataUrl = await QRCode.toDataURL(paymentLink.short_url);

    res.send(`
      <h2>Scan QR to Pay</h2>
      <img src="${qrDataUrl}" />
      <p><a href="${paymentLink.short_url}" target="_blank">Pay Now</a></p>
    `);

  } catch (err) {
    console.error("⚠️ Payment error:", err);
    res.status(500).send("Error: " + err.message);
  }
});

// ---------------- WEBHOOK ----------------
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
        const amountRs = payment.amount / 100;

        const UNIT_PRICE = 10;
        const units = amountRs / UNIT_PRICE;

        console.log("💰 Payment:", amountRs);
        console.log("🔋 Units:", units.toFixed(2));

        notifyESP32(units);
      }

      res.status(200).send("OK");
    } else {
      console.warn("❌ Invalid webhook signature");
      res.status(400).send("Invalid signature");
    }
  } catch (err) {
    console.error("⚠️ Webhook error:", err);
    res.status(500).send("Server error");
  }
});

// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ---------------- WEBSOCKET ----------------
const wss = new Server({ server, path: "/ws" });

// 🔥 Heartbeat function
function heartbeat() {
  this.isAlive = true;
}

wss.on("connection", (ws) => {
  console.log("🔌 ESP32 connected");

  ws.isAlive = true;

  // ✅ Handle pong
  ws.on("pong", heartbeat);

  ws.on("message", (msg) => {
    const message = msg.toString();
    console.log("📩 ESP32:", message);

    // Optional ping-pong support
    if (message === "ping") {
      ws.send("pong");
    }
  });

  ws.on("close", () => {
    console.log("❌ ESP32 disconnected");
  });

  ws.on("error", (err) => {
    console.log("⚠️ WS Error:", err.message);
  });
});

// 🔥 Keep-alive system (VERY IMPORTANT)
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      console.log("💀 Terminating dead client");
      return ws.terminate();
    }

    ws.isAlive = false;
    ws.ping(); // send ping
  });
}, 10000);

// Cleanup
wss.on("close", () => {
  clearInterval(interval);
});

// ---------------- SEND DATA ----------------
function notifyESP32(units) {
  console.log("📡 Sending units to ESP32:", units.toFixed(2));

  wss.clients.forEach(client => {
    if (client.readyState === client.OPEN) {
      client.send(`UNITS:${units.toFixed(2)}`);
    }
  });
}

