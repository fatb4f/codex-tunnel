# ChatGPT <-> Codex MCP Validation

## A) Smoke test (tool call + output)
Prompt:
```
Use codex-bridge/codex to run `pwd` and return only the output.
```
Pass: tool call occurs and returns the path.

## B) Deterministic constant
Prompt:
```
Call codex-bridge/codex with a prompt that returns EXACT text: MCP_OK_42
```
Pass: response is exactly `MCP_OK_42`.

## C) Session continuity
Prompt 1:
```
Start a Codex session and set x=7. Return the threadId/conversationId only.
```

Prompt 2 (using codex-bridge/codex-reply):
```
Continue the session with that threadId and ask: what is x? Return only the value.
```
Pass: returns `7`.

---

## Local inspection points

### FastMCP
- Run config: `codex-fastmcp/fastmcp.json`
- Console logs from `fastmcp run ...`

### Bridge behavior
- `codex-fastmcp/codex_bridge.py` (env passthrough, session handling)

### Caddy
- `codex-fastmcp/Caddyfile`
- Validate config:
  ```bash
  caddy validate --config /home/src404/src/codex-fastmcp/Caddyfile
  ```
- Service logs (if running as a service):
  ```bash
  journalctl -u caddy
  ```

### Connectivity
- Local origin:
  ```bash
  curl -I http://127.0.0.1:8000/mcp/
  ```
- Public endpoint:
  ```bash
  curl -I https://mcp.meowrz.uk/mcp/
  ```
