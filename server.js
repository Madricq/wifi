require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ✅ Get Access Token from IoTech
async function getAccessToken() {
  try {
    const params = new URLSearchParams();
    params.append('client_id', process.env.ClientId);
    params.append('client_secret', process.env.ClientSecret);
    params.append('grant_type', 'client_credentials');

    const response = await axios.post(
      'https://id.iotec.io/connect/token',
      params,
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    return response.data.access_token;
  } catch (err) {
    console.error('❌ Error getting access token:', err.response?.data || err.message);
    throw err;
  }
}

// ✅ POST /collect
app.post('/collect', async (req, res) => {
  try {
    const { phoneNumber, amount } = req.body;

    if (!phoneNumber || !amount) {
      return res.status(400).json({ message: 'phoneNumber and amount are required' });
    }

    const accessToken = await getAccessToken();

    const data = {
      category: "MobileMoney",
      currency: "UGX",
      walletId: process.env.LiveWalletID,
      externalId: `order_${Date.now()}`,
      payer: phoneNumber,
      payerNote: "Payment for order",
      amount: amount,
      payeeNote: "Thank you for your payment",
      channel: null,
      transactionChargesCategory: "ChargeWallet"
    };

    console.log("📤 Final Payload to IoTech (/collect):", JSON.stringify(data, null, 2));

    const response = await axios.post(
      'https://pay.iotec.io/api/collections/collect',
      data,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      message: `✅ Payment request sent to ${phoneNumber}`,
      result: response.data
    });
  } catch (err) {
    console.error('❌ Payment error (/collect):', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ✅ POST /api/pay - Used by your React frontend
app.post('/api/pay', async (req, res) => {
  const { phone, packageName, amount } = req.body;

  if (!phone || !packageName || !amount) {
    return res.status(400).json({ success: false, message: 'phone, packageName, and amount are required' });
  }

  try {
    const accessToken = await getAccessToken();

    const paymentPayload = {
      category: 'MobileMoney',
      currency: 'UGX',
      walletId: process.env.LiveWalletID,
      externalId: `order_${Date.now()}`,
      payer: phone,
      payerNote: `Payment for ${packageName}`,
      amount,
      payeeNote: `Payment for package ${packageName}`,
      channel: null,
      transactionChargesCategory: 'ChargeWallet'
    };

    console.log("📤 Payload to IoTech (/api/pay):", paymentPayload);

    const payment = await axios.post(
      'https://pay.iotec.io/api/collections/collect',
      paymentPayload,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({ success: true, data: payment.data });
  } catch (err) {
    console.error('❌ /api/pay error:', err.response?.data || err.message);
    res.status(500).json({
      success: false,
      message: err?.response?.data?.message || 'Payment failed',
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
