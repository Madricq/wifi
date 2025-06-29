const express = require('express');
const cors = require('cors');
const { RouterOSClient } = require('routeros-client');

const app = express();
const PORT = 5000;

const MIKROTIK_CONFIG = {
  host: '192.168.88.1',
  user: 'admin',
  password: '0785151142',
  port: 8728,
  mac: '4C:5E:0C:B7:DC:DD' // just for logging
};

app.use(cors());

function createMikrotikClient() {
  const { host, user, password, port } = MIKROTIK_CONFIG;
  return new RouterOSClient({ host, user, password, port, timeout: 10000 });
}

// Route to generate MikroTik config script
app.get('/api/generate/setup-script', async (req, res) => {
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

# === HOTSPOT USER ===
/ip hotspot user add name=test password=1234 profile=default comment="Test User"

# === ENABLE DNS ===
/ip dns set servers=8.8.8.8 allow-remote-requests=yes

# === ENABLE NAT FOR INTERNET ACCESS ===
/ip firewall nat add chain=srcnat out-interface=ether1 action=masquerade comment="hotspot-nat"

# === DONE ===
:put "\u2705 Hotspot setup complete!"

# === AUTO ALLOW MAC IF ALLOWED FROM BACKEND ===
/system scheduler remove [find name=check-macs]
/system scheduler add name=check-macs interval=1m on-event="\
:foreach i in=[/ip hotspot active find] do={\
  :local mac [/ip hotspot active get \$i mac-address];\
  :local ip [/ip hotspot active get \$i address];\
  :local url (\"http://192.168.0.105:4000/api/voucher/check?mac=\" . \$mac);\
  /tool fetch url=\$url mode=http dst-path=\"voucher-result.txt\" keep-result=yes;\
  :delay 1;\
  :local r [/file get [find name=\"voucher-result.txt\"] contents];\
  :if ([:find \$r \"\\\"allow\\\":true\"] != 0) do={\
    :local ds [:find \$r \"\\\"duration\\\":\\\"\"]\n    :set ds (\$ds + 13);\
    :local de [:find \$r \"\\\"\"\" starting-at=\$ds];\
    :local duration [:pick \$r \$ds \$de];\
    /ip firewall address-list add list=allowed-macs address=\$mac timeout=\$duration comment=\"Auto-allowed\";\
    :log info (\"\u2705 Allowed \" . \$mac . \" for \" . \$duration);\
  }\
  /file remove voucher-result.txt;\
}"
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

app.listen(PORT, () => {
  console.log(`\u2705 Backend running at port ${PORT}`);
  console.log(`Using MikroTik credentials: user=${MIKROTIK_CONFIG.user} mac=${MIKROTIK_CONFIG.mac}`);
});
