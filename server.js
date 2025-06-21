const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;
const BIND_ADDRESS = '0.0.0.0'; // Allows external devices (like MikroTik) to reach this server

app.use(cors());
app.use(express.json());

const DEVICES_FILE = path.join(__dirname, 'devices.json');

// Load devices.json or return empty array
function loadDevices() {
  try {
    return JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

// Save device data to devices.json
function saveDevices(devices) {
  fs.writeFileSync(DEVICES_FILE, JSON.stringify(devices, null, 2));
}

// POST: Create new registration link (hardcoded for now)
app.post('/api/devices/link', (req, res) => {
  const id = "test-device-001";
  const devices = loadDevices();

  if (!devices.some(d => d.id === id)) {
    devices.push({
      id,
      status: 'pending',
      ip: null,
      createdAt: new Date().toISOString(),
    });
    saveDevices(devices);
  }

  const registrationUrl = `http://192.168.206.1:${PORT}/api/devices/register/${id}`;
  console.log(`Generated registration link: ${registrationUrl}`);
  res.json({ id, registrationUrl });
});

// GET: MikroTik fetches script from this endpoint
app.get('/api/devices/register/:id', (req, res) => {
  const { id } = req.params;
  const devices = loadDevices();
  const device = devices.find(d => d.id === id);

  if (!device) {
    console.log(`❌ Registration attempt with invalid id: ${id}`);
    return res.status(404).send('Invalid id');
  }

  device.status = 'connected';
  device.ip = req.ip;
  device.connectedAt = new Date().toISOString();
  saveDevices(devices);

  const script = `/ip pool add name=hs-pool ranges=192.168.10.2-192.168.10.254
/ip dhcp-server add name=hs-dhcp interface=bridge1 address-pool=hs-pool disabled=no
/ip hotspot add name=hotspot1 interface=bridge1 address-pool=hs-pool profile=default
/system scheduler add name=firmware-update interval=1d on-event="/system package update install"
/system backup save name=auto-backup
/ip firewall filter add chain=input protocol=tcp dst-port=8291 action=accept comment="Allow Winbox"
/tool snmp set enabled=yes`;

  console.log(`✅ Register called for device id: ${id}`);
  console.log('⬇️ Sending script:\n', script);
  res.type('text/plain').send(script);
});

// Optional: Get device status
app.get('/api/devices/:id/status', (req, res) => {
  const devices = loadDevices();
  const device = devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  res.json(device);
});

// Start server
app.listen(PORT, BIND_ADDRESS, () => {
  console.log(`✅ Backend running at http://${BIND_ADDRESS}:${PORT}`);
});
