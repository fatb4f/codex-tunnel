# Systemd setup (root)

Service unit:
- `systemd/fastmcp-bridge.service`

Install:

```bash
sudo cp /home/src404/src/codex-tunnel/systemd/fastmcp-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fastmcp-bridge
```

Check:

```bash
sudo systemctl status fastmcp-bridge
sudo journalctl -u fastmcp-bridge -f
```

Notes:
- Uses `/home/src404/src/codex-tunnel/.env`
- Runs `/usr/bin/node /home/src404/src/codex-tunnel/server.js`
- Exposes `/remote/health` and `/remote/resume`
- Intended origin for Cloudflare Tunnel; Caddy is not required
