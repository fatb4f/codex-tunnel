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

## User service (static)

Install static user unit:

```bash
mkdir -p ~/.config/systemd/user
cp /home/src404/src/codex-tunnel/systemd/user/codex-remote-resume.service ~/.config/systemd/user/
systemctl --user daemon-reload
```

Entrypoint script used by `/remote/resume`:

- `/home/src404/src/codex-tunnel/scripts/ssh-start-codex-user-service.sh`

This script sets:
- `CODEX_PROJECT_KEY`
- `CODEX_PROJECT_PATH`
- `CODEX_EXTRA_ARGS`

Then starts (preferred):
- transient user service via `app2unit` (ideal for HyprWM/UWSM)

Fallback:
- `codex-remote-resume.service`

Launch command inside user session:
- `codex --dangerously-bypass-approvals-and-sandbox resume --last`
