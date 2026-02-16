# codex-fastmcp (Node SDK bridge)

This project runs a remote MCP server over streamable HTTP and exposes one typed tool: `codex_exec`.
The tool runs `codex exec` on the same machine with workspace path restrictions.

## Endpoint

- MCP endpoint: `http://127.0.0.1:8000/mcp`
- Health: `http://127.0.0.1:8000/`

## Local run

```bash
cd /home/src404/src/codex-fastmcp
npm install
npm run start
```

## Config

`/home/src404/src/codex-fastmcp/.env`

Important values:
- `MCP_HOST`, `MCP_PORT`, `MCP_PATH`
- `CODEX_COMMAND`, `CODEX_ARGS`, `CODEX_CWD`
- `CODEX_WORKSPACE_ROOT` (hard boundary for `cwd` input)
- `CODEX_TIMEOUT_MS`
- `BRIDGE_OUTPUT_MAX_BYTES`
- `BRIDGE_RUN_LOG_PATH` (JSONL execution log)
- `BRIDGE_DEBUG=1` for debug logs

## Execution telemetry

Each `codex_exec` call appends one JSON line to `BRIDGE_RUN_LOG_PATH` with:
- request envelope (`request_id`, `cwd`, `sandbox`, `model`, `prompt_sha256`, `prompt_bytes`)
- result summary (`exit_code`, `timed_out`, `duration_ms`)
- extracted command telemetry (`commands[]`, token usage if available)
- redacted output tails (`stdout_tail`, `stderr_tail`, `last_message_tail`)

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

## Inspector test

```bash
npx @modelcontextprotocol/inspector@latest --server-url http://localhost:8000/mcp --transport http
```

## Caddy

Caddy reverse proxy should forward `/mcp/*` to `127.0.0.1:8000`.
