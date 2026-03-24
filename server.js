const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const { Server } = require("ws");

const app = express();
app.use(bodyParser.json());

// Razorpay credentials
const RAZORPAY_KEY_ID = "your_key_id";
const RAZORPAY_KEY_SECRET = "your_key_secret";
const WEBHOOK_SECRET = "@Ashish92844"; 
const WEBHOOK_ID = "your_webhook_id"; 

// --- Webhook route ---
app.post('/razorpay/webhook', (req, res) => {
  const body = JSON.stringify(req.body);
  const signature = req.headers['x-razorpay-signature'];

  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(body)
    .digest('hex');

  if (signature === expectedSignature) {
    console.log("Webhook verified:", req.body.event);

    if (req.body.event === "payment.captured") {
      const payment = req.body.payload.payment.entity;
      const amountRs = payment.amount / 100; // paise → Rs
      console.log("Payment captured:", payment.id, "Amount:", amountRs);
      notifyESP32(amountRs); // 🔔 send to ESP32
    }
    res.status(200).send("OK");
  } else {
    console.warn("Invalid signature!");
    res.status(400).send("Invalid signature");
  }
});

// --- Start server ---
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// --- WebSocket server attached to Express ---
const wss = new Server({ server });

wss.on("connection", ws => {
  console.log("ESP32 connected via WebSocket");
  ws.on("message", msg => console.log("ESP32 says:", msg));
});

function notifyESP32(amount) {
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(`CONFIRM:${amount}`);
    }
  });
}