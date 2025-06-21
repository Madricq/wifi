const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

// Hardcoded base URL of your Render app
const BASE_URL = 'https://wifi-uv2m.onrender.com';

app.use(cors());
app.use(express.json());

const DEVICES_FILE = path.join(__dirname, 'devices.json');
const USERS_FILE = path.join(__dirname, 'users.json');         // For hotspot users
const PPPOE_USERS_FILE = path.join(__dirname, 'pppoeUsers.json'); // For PPPoE users
const PACKAGES_FILE = path.join(__dirname, 'packages.json');   // For packages

// Helpers to load and save JSON files
function loadJSON(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function saveJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ==============================
// Device Routes
// ==============================
app.post('/api/devices/link', (req, res) => {
  const id = "test-device-001"; // hardcoded for now
  const devices = loadJSON(DEVICES_FILE);

  if (!devices.some(d => d.id === id)) {
    devices.push({
      id,
      status: 'pending',
      ip: null,
      createdAt: new Date().toISOString(),
    });
    saveJSON(DEVICES_FILE, devices);
  }

  const registrationUrl = `${BASE_URL}/api/devices/register/${id}`;
  res.json({ id, registrationUrl });
});

app.get('/api/devices/register/:id', (req, res) => {
  const { id } = req.params;
  console.log(`Register called for device id: ${id}`);

  const devices = loadJSON(DEVICES_FILE);
  const device = devices.find(d => d.id === id);
  if (!device) return res.status(404).send('Invalid id');

  device.status = 'connected';
  device.ip = req.ip;
  device.connectedAt = new Date().toISOString();
  saveJSON(DEVICES_FILE, devices);

  const script = `/ip pool add name=hs-pool ranges=192.168.10.2-192.168.10.254
/ip dhcp-server add name=hs-dhcp interface=bridge1 address-pool=hs-pool disabled=no
/ip hotspot add name=hotspot1 interface=bridge1 address-pool=hs-pool profile=default
/system scheduler add name=firmware-update interval=1d on-event="/system package update install"
/system backup save name=auto-backup
/ip firewall filter add chain=input protocol=tcp dst-port=8291 action=accept comment="Allow Winbox"
/tool snmp set enabled=yes`;

  console.log('Sending script:', script);
  res.type('text/plain').send(script);
});

app.get('/api/devices', (req, res) => {
  const devices = loadJSON(DEVICES_FILE);
  res.json(devices);
});

app.get('/api/devices/:id/status', (req, res) => {
  const devices = loadJSON(DEVICES_FILE);
  const device = devices.find(d => d.id === req.params.id);
  if (!device) return res.status(404).json({ error: 'Not found' });
  res.json(device);
});

// ==============================
// User Management Routes
// ==============================

// Get hotspot users
app.get('/api/users/hotspot', (req, res) => {
  const users = loadJSON(USERS_FILE);
  res.json(users);
});

// Get PPPoE users
app.get('/api/users/pppoe', (req, res) => {
  const users = loadJSON(PPPOE_USERS_FILE);
  res.json(users);
});

// Pause hotspot user
app.post('/api/users/hotspot/:username/pause', (req, res) => {
  const users = loadJSON(USERS_FILE);
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'paused';
  saveJSON(USERS_FILE, users);
  res.json({ message: `User ${user.username} paused` });
});

// Resume hotspot user
app.post('/api/users/hotspot/:username/resume', (req, res) => {
  const users = loadJSON(USERS_FILE);
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'active';
  saveJSON(USERS_FILE, users);
  res.json({ message: `User ${user.username} resumed` });
});

// Delete hotspot user
app.delete('/api/users/hotspot/:username', (req, res) => {
  let users = loadJSON(USERS_FILE);
  const before = users.length;
  users = users.filter(u => u.username !== req.params.username);
  if (users.length === before) return res.status(404).json({ error: 'User not found' });

  saveJSON(USERS_FILE, users);
  res.json({ message: `User ${req.params.username} deleted` });
});

// Repeat for PPPoE
app.post('/api/users/pppoe/:username/pause', (req, res) => {
  const users = loadJSON(PPPOE_USERS_FILE);
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'paused';
  saveJSON(PPPOE_USERS_FILE, users);
  res.json({ message: `PPPoE user ${user.username} paused` });
});

app.post('/api/users/pppoe/:username/resume', (req, res) => {
  const users = loadJSON(PPPOE_USERS_FILE);
  const user = users.find(u => u.username === req.params.username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.status = 'active';
  saveJSON(PPPOE_USERS_FILE, users);
  res.json({ message: `PPPoE user ${user.username} resumed` });
});

app.delete('/api/users/pppoe/:username', (req, res) => {
  let users = loadJSON(PPPOE_USERS_FILE);
  const before = users.length;
  users = users.filter(u => u.username !== req.params.username);
  if (users.length === before) return res.status(404).json({ error: 'User not found' });

  saveJSON(PPPOE_USERS_FILE, users);
  res.json({ message: `PPPoE user ${req.params.username} deleted` });
});

// ==============================
// Start Server
// ==============================
app.listen(PORT, () => {
  console.log(`✅ Backend running at port ${PORT}`);
});
