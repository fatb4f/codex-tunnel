# Systemd setup (root)

Node remote access bridge service unit:
- systemd/fastmcp-bridge.service

Install (requires sudo):

1) Copy unit
   sudo cp /home/src404/src/codex-fastmcp/systemd/fastmcp-bridge.service /etc/systemd/system/

2) Reload systemd
   sudo systemctl daemon-reload

3) Enable + start
   sudo systemctl enable --now fastmcp-bridge

4) Check status/logs
   sudo systemctl status fastmcp-bridge
   sudo journalctl -u fastmcp-bridge -f
   tail -f /home/src404/.local/state/codex/codex-fastmcp/bridge.log

Notes:
- Uses /home/src404/src/codex-fastmcp/.env for CODEX_* and MCP_*.
- Runs `/usr/bin/node /home/src404/src/codex-fastmcp/server.js`.
- Appends stdout/stderr to `/home/src404/.local/state/codex/codex-fastmcp/bridge.log`.
- Exposes `/remote/health` and `/remote/resume` in addition to `/mcp`.

---

Caddy service unit:
- systemd/caddy.service

Install (requires sudo):

1) Copy unit
   sudo cp /home/src404/src/codex-fastmcp/systemd/caddy.service /etc/systemd/system/

2) Reload systemd
   sudo systemctl daemon-reload

3) Enable + start
   sudo systemctl enable --now caddy

4) Check status/logs
   sudo systemctl status caddy
   sudo journalctl -u caddy -f

Notes:
- Runs Caddy with /home/src404/src/codex-fastmcp/Caddyfile
- Ensure port 80/443 are forwarded to this host
- Caddy should proxy `/remote*` and `/mcp*` to `127.0.0.1:8000`.
