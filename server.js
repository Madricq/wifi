const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const RouterOSClient = require('node-routeros').RouterOSClient;

const app = express();
const PORT = 5000;

// Hardcoded MikroTik credentials
const MIKROTIK_CONFIG = {
  host: '192.168.88.1', // change to your MikroTik IP
  user: 'admin',
  password: '0785151142',
  port: 8728,
  mac: '4C:5E:0C:B7:DC:DD' // just for logging, not used in connection
};

app.use(cors());
app.use(express.json());

const DEVICES_FILE = path.join(__dirname, 'devices.json');

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

function createMikrotikClient() {
  const { host, user, password, port } = MIKROTIK_CONFIG;
  return new RouterOSClient({ host, user, password, port, timeout: 10000 });
}

// ========== Device Routes (unchanged) ==========
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

  const registrationUrl = `https://wifi-uv2m.onrender.com/api/devices/register/${id}`;
  res.json({ id, registrationUrl });
});

app.get('/api/devices/register/:id', (req, res) => {
  const { id } = req.params;

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

// ========== Hotspot Users CRUD ==========
app.get('/api/users/hotspot', async (req, res) => {
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const users = await conn.menu('/ip/hotspot/user').getAll();
    await conn.close();
    res.json(users.map(u => ({
      id: u['.id'],
      username: u.name,
      disabled: u.disabled === 'true',
      profile: u.profile,
      comment: u.comment || '',
      uptime: u.uptime || 'N/A',
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch hotspot users' });
  }
});

app.post('/api/users/hotspot', async (req, res) => {
  const { username, password, profile, comment } = req.body;
  if (!username || !password || !profile) {
    return res.status(400).json({ error: 'username, password and profile required' });
  }
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ip/hotspot/user');
    const id = await menu.add({ name: username, password, profile, comment });
    await conn.close();
    res.json({ message: 'Hotspot user created', id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create hotspot user' });
  }
});

app.put('/api/users/hotspot/:id', async (req, res) => {
  const id = req.params.id;
  const { username, password, profile, comment, disabled } = req.body;
  if (!username || !profile) {
    return res.status(400).json({ error: 'username and profile required' });
  }
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ip/hotspot/user');
    await menu.set(id, {
      name: username,
      ...(password ? { password } : {}),
      profile,
      comment,
      disabled: disabled ? 'yes' : 'no'
    });
    await conn.close();
    res.json({ message: 'Hotspot user updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update hotspot user' });
  }
});

app.delete('/api/users/hotspot/:id', async (req, res) => {
  const id = req.params.id;
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ip/hotspot/user');
    await menu.remove(id);
    await conn.close();
    res.json({ message: 'Hotspot user deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete hotspot user' });
  }
});

// ========== Hotspot Profiles (packages) CRUD ==========
app.get('/api/hotspot/profiles', async (req, res) => {
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const profiles = await conn.menu('/ip/hotspot/profile').getAll();
    await conn.close();
    res.json(profiles.map(p => ({
      id: p['.id'],
      name: p.name,
      dnsName: p.dnsName,
      rateLimit: p.rateLimit,
      sessionTimeout: p.sessionTimeout,
      sharedUsers: p.sharedUsers,
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch hotspot profiles' });
  }
});

app.post('/api/hotspot/profiles', async (req, res) => {
  const { name, dnsName, rateLimit, sessionTimeout, sharedUsers } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ip/hotspot/profile');
    const id = await menu.add({ name, dnsName, rateLimit, sessionTimeout, sharedUsers });
    await conn.close();
    res.json({ message: 'Hotspot profile created', id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create hotspot profile' });
  }
});

app.put('/api/hotspot/profiles/:id', async (req, res) => {
  const id = req.params.id;
  const { name, dnsName, rateLimit, sessionTimeout, sharedUsers } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ip/hotspot/profile');
    await menu.set(id, { name, dnsName, rateLimit, sessionTimeout, sharedUsers });
    await conn.close();
    res.json({ message: 'Hotspot profile updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update hotspot profile' });
  }
});

app.delete('/api/hotspot/profiles/:id', async (req, res) => {
  const id = req.params.id;
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ip/hotspot/profile');
    await menu.remove(id);
    await conn.close();
    res.json({ message: 'Hotspot profile deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete hotspot profile' });
  }
});

// ========== PPPoE Users CRUD ==========
app.get('/api/users/pppoe', async (req, res) => {
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const users = await conn.menu('/ppp/secret').getAll();
    await conn.close();
    res.json(users.map(u => ({
      id: u['.id'],
      username: u.name,
      disabled: u.disabled === 'true',
      profile: u.profile,
      comment: u.comment || '',
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch PPPoE users' });
  }
});

app.post('/api/users/pppoe', async (req, res) => {
  const { username, password, profile, comment } = req.body;
  if (!username || !password || !profile) {
    return res.status(400).json({ error: 'username, password and profile required' });
  }
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ppp/secret');
    const id = await menu.add({ name: username, password, profile, comment });
    await conn.close();
    res.json({ message: 'PPPoE user created', id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create PPPoE user' });
  }
});

app.put('/api/users/pppoe/:id', async (req, res) => {
  const id = req.params.id;
  const { username, password, profile, comment, disabled } = req.body;
  if (!username || !profile) {
    return res.status(400).json({ error: 'username and profile required' });
  }
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ppp/secret');
    await menu.set(id, {
      name: username,
      ...(password ? { password } : {}),
      profile,
      comment,
      disabled: disabled ? 'yes' : 'no'
    });
    await conn.close();
    res.json({ message: 'PPPoE user updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update PPPoE user' });
  }
});

app.delete('/api/users/pppoe/:id', async (req, res) => {
  const id = req.params.id;
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ppp/secret');
    await menu.remove(id);
    await conn.close();
    res.json({ message: 'PPPoE user deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete PPPoE user' });
  }
});

// ========== PPPoE Profiles (packages) CRUD ==========
app.get('/api/pppoe/profiles', async (req, res) => {
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const profiles = await conn.menu('/ppp/profile').getAll();
    await conn.close();
    res.json(profiles.map(p => ({
      id: p['.id'],
      name: p.name,
      localAddress: p.localAddress,
      remoteAddress: p.remoteAddress,
      rateLimit: p.rateLimit,
      onlyOne: p.onlyOne === 'true',
    })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to fetch PPPoE profiles' });
  }
});

app.post('/api/pppoe/profiles', async (req, res) => {
  const { name, localAddress, remoteAddress, rateLimit, onlyOne } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ppp/profile');
    const id = await menu.add({
      name,
      localAddress,
      remoteAddress,
      rateLimit,
      onlyOne: onlyOne ? 'yes' : 'no'
    });
    await conn.close();
    res.json({ message: 'PPPoE profile created', id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to create PPPoE profile' });
  }
});

app.put('/api/pppoe/profiles/:id', async (req, res) => {
  const id = req.params.id;
  const { name, localAddress, remoteAddress, rateLimit, onlyOne } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ppp/profile');
    await menu.set(id, {
      name,
      localAddress,
      remoteAddress,
      rateLimit,
      onlyOne: onlyOne ? 'yes' : 'no'
    });
    await conn.close();
    res.json({ message: 'PPPoE profile updated' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to update PPPoE profile' });
  }
});

app.delete('/api/pppoe/profiles/:id', async (req, res) => {
  const id = req.params.id;
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const menu = conn.menu('/ppp/profile');
    await menu.remove(id);
    await conn.close();
    res.json({ message: 'PPPoE profile deleted' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to delete PPPoE profile' });
  }
});

// ========== Sync Routes ==========
app.get('/api/sync/hotspot', async (req, res) => {
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const hotspotUsers = await conn.menu('/ip/hotspot/user').getAll();
    const hotspotProfiles = await conn.menu('/ip/hotspot/profile').getAll();
    await conn.close();

    res.json({
      users: hotspotUsers.map(u => ({
        id: u['.id'],
        username: u.name,
        disabled: u.disabled === 'true',
        profile: u.profile,
        comment: u.comment || '',
        uptime: u.uptime || 'N/A',
      })),
      profiles: hotspotProfiles.map(p => ({
        id: p['.id'],
        name: p.name,
        dnsName: p.dnsName,
        rateLimit: p.rateLimit,
        sessionTimeout: p.sessionTimeout,
        sharedUsers: p.sharedUsers,
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to sync hotspot data' });
  }
});

app.get('/api/sync/pppoe', async (req, res) => {
  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const pppoeUsers = await conn.menu('/ppp/secret').getAll();
    const pppoeProfiles = await conn.menu('/ppp/profile').getAll();
    await conn.close();

    res.json({
      users: pppoeUsers.map(u => ({
        id: u['.id'],
        username: u.name,
        disabled: u.disabled === 'true',
        profile: u.profile,
        service: u.service,
        comment: u.comment || '',
      })),
      profiles: pppoeProfiles.map(p => ({
        id: p['.id'],
        name: p.name,
        localAddress: p.localAddress,
        remoteAddress: p.remoteAddress,
        rateLimit: p.rateLimit,
        onlyOne: p.onlyOne === 'true',
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to sync PPPoE data' });
  }
});

// ========== Start Server ==========
app.listen(PORT, () => {
  console.log(`✅ Backend running at port ${PORT}`);
  console.log(`Using MikroTik credentials: user=${MIKROTIK_CONFIG.user} mac=${MIKROTIK_CONFIG.mac}`);
});
