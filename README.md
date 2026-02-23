# codex-fastmcp (Remote Access Bridge)

This project now serves as the remote access bridge for phone-triggered Codex resume flows over Cloudflare Tunnel.

It also keeps the MCP bridge endpoint available for compatibility.

## Endpoints

- Health: `http://127.0.0.1:8000/`
- Remote health: `http://127.0.0.1:8000/remote/health`
- Remote trigger: `POST http://127.0.0.1:8000/remote/resume`
- MCP endpoint (optional compatibility path): `http://127.0.0.1:8000/mcp`

## Local run

```bash
cd /home/src404/src/codex-fastmcp
npm install
npm run start
```

## Config

`/home/src404/src/codex-fastmcp/.env`

Important values (bridge):
- `MCP_HOST`, `MCP_PORT`, `MCP_PATH`
- `CODEX_COMMAND`, `CODEX_ARGS`, `CODEX_CWD`
- `CODEX_WORKSPACE_ROOT` (hard boundary for `cwd` input)
- `CODEX_TIMEOUT_MS`
- `BRIDGE_OUTPUT_MAX_BYTES`
- `BRIDGE_RUN_LOG_PATH` (JSONL execution log)
- `BRIDGE_DEBUG=1` for debug logs

Important values (remote access):
- `REMOTE_ACCESS_TOKEN` (Bearer token for `/remote/resume`)
- `REMOTE_PROJECT_ROOT` (hard boundary for allowed project paths)
- `REMOTE_RESUME_COMMAND` (default: `/home/src404/.local/bin/xx.sh`)
- `REMOTE_TRIGGER_TIMEOUT_MS`
- `REMOTE_RUN_LOG_PATH`

## Remote trigger request

```json
{
  "project_path": "/home/src404/src/identity-graph",
  "project_key": "identity-graph",
  "extra_args": []
}
```

Auth header (recommended):

```text
Authorization: Bearer <REMOTE_ACCESS_TOKEN>
```

## Telemetry

Each `codex_exec` call appends one JSON line to `BRIDGE_RUN_LOG_PATH` with:
- request envelope (`request_id`, `cwd`, `sandbox`, `model`, `prompt_sha256`, `prompt_bytes`)
- result summary (`exit_code`, `timed_out`, `duration_ms`)
- extracted command telemetry (`commands[]`, token usage if available)
- redacted output tails (`stdout_tail`, `stderr_tail`, `last_message_tail`)

Each remote resume trigger appends one JSON line to `REMOTE_RUN_LOG_PATH` with:
- request envelope (`request_id`, `project_path`, `project_key`, command/args)
- result summary (`exit_code`, `timed_out`, `duration_ms`)
- redacted output tails (`stdout_tail`, `stderr_tail`)

Generate behavior reports:

```bash
npm run report
```

Outputs:
- `logs/bridge_behavior_report.json`
- `logs/bridge_behavior_report.md`

## Systemd

Use unit: `systemd/fastmcp-bridge.service`

```bash
sudo cp /home/src404/src/codex-fastmcp/systemd/fastmcp-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl restart fastmcp-bridge
sudo systemctl enable fastmcp-bridge
```

Check:

```bash
systemctl status fastmcp-bridge --no-pager
journalctl -u fastmcp-bridge -n 80 --no-pager
tail -n 80 ~/.local/state/codex/codex-fastmcp/bridge.log
```

## MCP Inspector test (optional)

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8000/mcp --transport http
```

## Caddy / Cloudflare

Caddy reverse proxy should forward both `/remote/*` and `/mcp/*` to `127.0.0.1:8000`.
