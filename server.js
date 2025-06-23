const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const RouterOSClient = require('node-routeros').RouterOSClient;

const app = express();
const PORT = 5000;

const MIKROTIK_CONFIG = {
  host: '192.168.88.1',
  user: 'admin',
  password: '0785151142',
  port: 8728,
  mac: '4C:5E:0C:B7:DC:DD'
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

app.post('/api/devices/link', (req, res) => {
  const id = "test-device-001";
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

app.get('/api/devices/register/:id', async (req, res) => {
  const { id } = req.params;
  const devices = loadJSON(DEVICES_FILE);
  const device = devices.find(d => d.id === id);
  if (!device) return res.status(404).send('Invalid id');

  device.status = 'connected';
  device.ip = req.ip;
  device.connectedAt = new Date().toISOString();
  saveJSON(DEVICES_FILE, devices);

  const script = `
/ip pool remove [find name=madric-pool]
/ip dhcp-server remove [find name=madric-dhcp]
/ip hotspot remove [find name=madric]
/ip hotspot profile remove [find name=madric-profile]
/ip dhcp-server network remove [find where gateway=192.168.100.1]
/ip address remove [find address~"192.168.100.1"]
/ip firewall filter remove [find comment="Allow Winbox"]
/system scheduler remove [find name=firmware-update]
/ip pool add name=madric-pool ranges=192.168.100.2-192.168.100.254
/ip dhcp-server add name=madric-dhcp interface=bridge1 address-pool=madric-pool disabled=no
/ip hotspot profile add name=madric-profile hotspot-address=192.168.100.1 html-directory=hotspot use-radius=no
/ip hotspot add name=madric interface=bridge1 address-pool=madric-pool profile=madric-profile
/ip dhcp-server network add address=192.168.100.0/24 gateway=192.168.100.1 dns-server=8.8.8.8
/ip address add address=192.168.100.1/24 interface=bridge1
/ip firewall filter add chain=input protocol=tcp dst-port=8291 action=accept comment="Allow Winbox"
/tool snmp set enabled=yes
/system backup save name=auto-backup
/system scheduler add name=firmware-update interval=1d on-event="/system package update install"
`;

  const conn = createMikrotikClient();
  try {
    await conn.connect();
    const commands = script.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));

    for (const cmd of commands) {
      await conn.write(cmd);
    }
    await conn.close();
  } catch (e) {
    console.error('Failed to apply MikroTik setup:', e);
  }

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

// Keep rest of CRUD logic for hotspot, pppoe, profiles unchanged
// Your full CRUD routes are assumed to follow here as before...

app.listen(PORT, () => {
  console.log(`✅ Backend running at port ${PORT}`);
  console.log(`Using MikroTik credentials: user=${MIKROTIK_CONFIG.user} mac=${MIKROTIK_CONFIG.mac}`);
});
