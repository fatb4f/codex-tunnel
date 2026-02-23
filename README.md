# codex-tunnel (Cloudflare Remote Access Bridge)

Remote trigger service for Codex resume flows, intended to run behind Cloudflare Tunnel.

## Endpoints

- Health: `GET /`
- Remote health: `GET /remote/health`
- Remote trigger: `POST /remote/resume`

## Local run

```bash
cd /home/src404/src/codex-tunnel
npm install
npm run start
```

## Config

Edit `/home/src404/src/codex-tunnel/.env`:

- `REMOTE_HOST`, `REMOTE_PORT`
- `REMOTE_ACCESS_TOKEN` (Bearer token for trigger auth)
- `REMOTE_PROJECT_ROOT` (hard path boundary)
- `REMOTE_RESUME_COMMAND` (default `/home/src404/.local/bin/xx.sh`)
- `REMOTE_TRIGGER_TIMEOUT_MS`
- `REMOTE_RUN_LOG_PATH`

## Trigger request

```json
{
  "project_path": "/home/src404/src/identity-graph",
  "project_key": "identity-graph",
  "extra_args": []
}
```

Recommended auth header:

```text
Authorization: Bearer <REMOTE_ACCESS_TOKEN>
```

## Logging

Each trigger appends one JSON line to `REMOTE_RUN_LOG_PATH` including:
- request metadata (`request_id`, project path/key, command/args)
- execution summary (`exit_code`, `timed_out`, `duration_ms`)
- redacted output tails

Generate summary report:

```bash
npm run report
```

## Systemd

Install:

```bash
sudo cp /home/src404/src/codex-tunnel/systemd/fastmcp-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fastmcp-bridge
```

Check:

```bash
systemctl status fastmcp-bridge --no-pager
journalctl -u fastmcp-bridge -n 80 --no-pager
```

## Cloudflare Tunnel

Caddy is not required.

Point tunnel ingress directly to origin `http://127.0.0.1:<REMOTE_PORT>`.
