const express = require('express');
const cors = require('cors');
const { RouterOSClient } = require('node-routeros');
const mongoose = require('mongoose');
const moment = require('moment');
require('dotenv').config();

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/mikrotik', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const VoucherSchema = new mongoose.Schema({
  code: String,
  amount: Number,
  duration: Number, // in minutes
  used: Boolean,
  usedAt: Date,
  usedBy: String,
});

const Voucher = mongoose.model('Voucher', VoucherSchema);

// MikroTik config
const MIKROTIK_CONFIG = {
  host: '192.168.88.1',
  user: 'admin',
  password: '0785151142',
  port: 8728,
};

function createMikrotikClient() {
  return new RouterOSClient({
    host: MIKROTIK_CONFIG.host,
    user: MIKROTIK_CONFIG.user,
    password: MIKROTIK_CONFIG.password,
    port: MIKROTIK_CONFIG.port,
    timeout: 10000,
  });
}

// 🔐 Redeem voucher
app.post('/api/redeem', async (req, res) => {
  const { code, mac } = req.body;

  try {
    const voucher = await Voucher.findOne({ code });

    if (!voucher) return res.json({ success: false, message: 'Voucher not found' });
    if (voucher.used) return res.json({ success: false, message: 'Voucher already used' });

    voucher.used = true;
    voucher.usedAt = new Date();
    voucher.usedBy = mac;
    await voucher.save();

    res.json({ success: true, message: 'Voucher redeemed', duration: voucher.duration });
  } catch (err) {
    console.error('Redeem error:', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ✅ MikroTik checks MAC with duration control
app.get('/api/check', async (req, res) => {
  const { mac } = req.query;
  if (!mac) return res.status(400).json({ allow: false, message: 'MAC required' });

  try {
    const voucher = await Voucher.findOne({ usedBy: mac, used: true });

    if (voucher) {
      const now = moment();
      const expiry = moment(voucher.usedAt).add(voucher.duration, 'minutes');

      if (now.isBefore(expiry)) {
        return res.json({ allow: true, duration: voucher.duration });
      } else {
        return res.json({ allow: false, message: 'Voucher expired' });
      }
    } else {
      return res.json({ allow: false });
    }
  } catch (err) {
    console.error('Check error:', err.message);
    res.status(500).json({ allow: false });
  }
});

// 🔧 MikroTik setup script generator
app.get('/api/devices/register/:id', async (req, res) => {
  const script = `
# === (OPTIONAL) CREATE BRIDGE IF MISSING ===
/interface bridge add name=bridge1
/interface bridge port add bridge=bridge1 interface=ether2
/interface bridge port add bridge=bridge1 interface=wlan1

# === CLEAN OLD CONFIGS ===
/ip pool remove [find name=hotspot-pool]
/ip dhcp-server remove [find name=hotspot-dhcp]
/ip hotspot remove [find name=hotspot1]
/ip hotspot profile remove [find name=hotspot-profile]
/ip address remove [find address~"192.168.100."]
/ip dhcp-server network remove [find address~"192.168.100."]
/ip firewall nat remove [find comment="hotspot-nat"]

# === IP POOL & ADDRESS ===
/ip pool add name=hotspot-pool ranges=192.168.100.10-192.168.100.254
/ip address add address=192.168.100.1/24 interface=bridge1 comment="Hotspot Gateway"

# === DHCP SERVER ===
/ip dhcp-server add name=hotspot-dhcp interface=bridge1 address-pool=hotspot-pool disabled=no
/ip dhcp-server network add address=192.168.100.0/24 gateway=192.168.100.1 dns-server=8.8.8.8

# === HOTSPOT SETUP ===
/ip hotspot profile add name=hotspot-profile hotspot-address=192.168.100.1 html-directory=hotspot use-radius=no
/ip hotspot add name=hotspot1 interface=bridge1 address-pool=hotspot-pool profile=hotspot-profile

# === ENABLE DNS ===
/ip dns set servers=8.8.8.8 allow-remote-requests=yes

# === ENABLE NAT FOR INTERNET ACCESS ===
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="hotspot-nat"

# === DONE ===
:put "✅ Hotspot setup complete!"
`;

  try {
    const conn = createMikrotikClient();
    await conn.connect();
    const commands = script.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

    for (const cmd of commands) {
      await conn.write(cmd);
    }
    await conn.close();
  } catch (e) {
    console.error('MikroTik script error:', e);
  }

  res.type('text/plain').send(script);
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Backend running at http://localhost:${PORT}`);
});
