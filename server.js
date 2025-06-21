const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const RouterOSClient = require('node-routeros').RouterOSClient;

const app = express();
const PORT = 5000;

// Hardcoded base URL of your Render app
const BASE_URL = 'https://wifi-uv2m.onrender.com';

app.use(cors());
app.use(express.json());

const DEVICES_FILE = path.join(__dirname, 'devices.json');

// Helpers to load and save JSON files (for devices)
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

// Helper to create MikroTik client dynamically
function createMikrotikClient({ host, user, password, port = 8728 }) {
  return new RouterOSClient({
    host,
    user,
    password,
    port,
    timeout: 10000,
  });
}

// ==============================
// Device Routes (unchanged)
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

  const script = `

# Create IP Pool for Hotspot Users
/ip pool add name=madric-pool ranges=192.168.100.2-192.168.100.254

# Add DHCP Server for Hotspot
/ip dhcp-server
add name=madric-dhcp interface=bridge1 address-pool=madric-pool disabled=no

# Configure Hotspot Profile (if needed)
/ip hotspot profile
add name=madric-profile hotspot-address=192.168.100.1 html-directory=hotspot use-radius=no

# Setup Hotspot Server
/ip hotspot
add name=madric interface=bridge1 address-pool=madric-pool profile=madric-profile

# Set DHCP Network config for Hotspot
/ip dhcp-server network
add address=192.168.100.0/24 gateway=192.168.100.1 dns-server=8.8.8.8

# Assign IP to bridge1 for Hotspot
/ip address add address=192.168.100.1/24 interface=bridge1

# Firewall Rule to allow Winbox
/ip firewall filter add chain=input protocol=tcp dst-port=8291 action=accept comment="Allow Winbox"

# Optional: Enable SNMP
/tool snmp set enabled=yes

# Auto Backup
/system backup save name=auto-backup

# Schedule Firmware Update
/system scheduler
add name=firmware-update interval=1d on-event="/system package update install"

`;
  console.log('Device registered:', device);
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
// User Management Routes with dynamic MikroTik connection
// ==============================

// Get hotspot users
app.get('/api/users/hotspot', async (req, res) => {
  const { host, user, password, port } = req.query;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    const users = await conn.menu('/ip/hotspot/user').getAll();
    await conn.close();

    const formattedUsers = users.map(u => ({
      username: u.name,
      status: u.disabled === 'true' ? 'paused' : 'active',
      profile: u.profile,
      comment: u.comment || '',
      uptime: u.uptime || 'N/A',
    }));

    res.json(formattedUsers);
  } catch (error) {
    console.error('MikroTik hotspot users error:', error);
    res.status(500).json({ error: 'Failed to fetch hotspot users' });
  }
});

// Pause hotspot user
app.post('/api/users/hotspot/:username/pause', async (req, res) => {
  const { host, user, password, port } = req.body;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const username = req.params.username;
  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    // Disable user (pause)
    const usersMenu = conn.menu('/ip/hotspot/user');
    const userEntry = (await usersMenu.where({ name: username }))[0];
    if (!userEntry) {
      await conn.close();
      return res.status(404).json({ error: 'User not found' });
    }

    await usersMenu.set(userEntry['.id'], { disabled: 'yes' });
    await conn.close();

    res.json({ message: `User ${username} paused` });
  } catch (error) {
    console.error('Pause hotspot user error:', error);
    res.status(500).json({ error: 'Failed to pause user' });
  }
});

// Resume hotspot user
app.post('/api/users/hotspot/:username/resume', async (req, res) => {
  const { host, user, password, port } = req.body;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const username = req.params.username;
  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    // Enable user (resume)
/* */
    const usersMenu = conn.menu('/ip/hotspot/user');
    const userEntry = (await usersMenu.where({ name: username }))[0];
    if (!userEntry) {
      await conn.close();
      return res.status(404).json({ error: 'User not found' });
    }

    await usersMenu.set(userEntry['.id'], { disabled: 'no' });
    await conn.close();

    res.json({ message: `User ${username} resumed` });
  } catch (error) {
    console.error('Resume hotspot user error:', error);
    res.status(500).json({ error: 'Failed to resume user' });
  }
});

// Delete hotspot user
app.delete('/api/users/hotspot/:username', async (req, res) => {
  const { host, user, password, port } = req.body;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const username = req.params.username;
  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    const usersMenu = conn.menu('/ip/hotspot/user');
    const userEntry = (await usersMenu.where({ name: username }))[0];
    if (!userEntry) {
      await conn.close();
      return res.status(404).json({ error: 'User not found' });
    }

    await usersMenu.remove(userEntry['.id']);
    await conn.close();

    res.json({ message: `User ${username} deleted` });
  } catch (error) {
    console.error('Delete hotspot user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Repeat similarly for PPPoE users

// Get PPPoE users
app.get('/api/users/pppoe', async (req, res) => {
  const { host, user, password, port } = req.query;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    const users = await conn.menu('/ppp/secret').getAll();
    await conn.close();

    const formattedUsers = users.map(u => ({
      username: u.name,
      status: u.disabled === 'true' ? 'paused' : 'active',
      profile: u.profile,
      comment: u.comment || '',
    }));

    res.json(formattedUsers);
  } catch (error) {
    console.error('MikroTik PPPoE users error:', error);
    res.status(500).json({ error: 'Failed to fetch PPPoE users' });
  }
});

// Pause PPPoE user
app.post('/api/users/pppoe/:username/pause', async (req, res) => {
  const { host, user, password, port } = req.body;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const username = req.params.username;
  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    const usersMenu = conn.menu('/ppp/secret');
    const userEntry = (await usersMenu.where({ name: username }))[0];
    if (!userEntry) {
      await conn.close();
      return res.status(404).json({ error: 'User not found' });
    }

    await usersMenu.set(userEntry['.id'], { disabled: 'yes' });
    await conn.close();

    res.json({ message: `PPPoE user ${username} paused` });
  } catch (error) {
    console.error('Pause PPPoE user error:', error);
    res.status(500).json({ error: 'Failed to pause PPPoE user' });
  }
});

// Resume PPPoE user
app.post('/api/users/pppoe/:username/resume', async (req, res) => {
  const { host, user, password, port } = req.body;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const username = req.params.username;
  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    const usersMenu = conn.menu('/ppp/secret');
    const userEntry = (await usersMenu.where({ name: username }))[0];
    if (!userEntry) {
      await conn.close();
      return res.status(404).json({ error: 'User not found' });
    }

    await usersMenu.set(userEntry['.id'], { disabled: 'no' });
    await conn.close();

    res.json({ message: `PPPoE user ${username} resumed` });
  } catch (error) {
    console.error('Resume PPPoE user error:', error);
    res.status(500).json({ error: 'Failed to resume PPPoE user' });
  }
});

// Delete PPPoE user
app.delete('/api/users/pppoe/:username', async (req, res) => {
  const { host, user, password, port } = req.body;
  if (!host || !user || !password) return res.status(400).json({ error: 'Missing MikroTik credentials' });

  const username = req.params.username;
  const conn = createMikrotikClient({ host, user, password, port });

  try {
    await conn.connect();
    const usersMenu = conn.menu('/ppp/secret');
    const userEntry = (await usersMenu.where({ name: username }))[0];
    if (!userEntry) {
      await conn.close();
      return res.status(404).json({ error: 'User not found' });
    }

    await usersMenu.remove(userEntry['.id']);
    await conn.close();

    res.json({ message: `PPPoE user ${username} deleted` });
  } catch (error) {
    console.error('Delete PPPoE user error:', error);
    res.status(500).json({ error: 'Failed to delete PPPoE user' });
  }
});

// ==============================
// Start Server
// ==============================
app.listen(PORT, () => {
  console.log(`✅ Backend running at port ${PORT}`);
});
