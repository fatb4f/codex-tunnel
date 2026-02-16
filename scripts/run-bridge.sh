#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/src404/src/codex-fastmcp"
cd "$REPO_DIR"

MCP_HOST="${MCP_HOST:-127.0.0.1}"
MCP_PORT="${MCP_PORT:-8000}"
MCP_PATH="${MCP_PATH:-/mcp}"
CODEX_COMMAND="${CODEX_COMMAND:-codex}"
CODEX_ARGS="${CODEX_ARGS:-mcp-server}"
CODEX_CWD="${CODEX_CWD:-}"

if [[ -n "$CODEX_CWD" ]]; then
  cd "$CODEX_CWD"
fi

# Split CODEX_ARGS into an argv array.
read -r -a CODEX_ARGS_ARR <<< "$CODEX_ARGS"

PROXY_ARGS=(
  --host "$MCP_HOST"
  --port "$MCP_PORT"
  --server stream
  --streamEndpoint "$MCP_PATH"
)

if [[ "${BRIDGE_DEBUG:-0}" =~ ^(1|true|yes)$ ]]; then
  PROXY_ARGS+=(--debug)
fi

exec "$REPO_DIR/node_modules/.bin/mcp-proxy" "${PROXY_ARGS[@]}" -- "$CODEX_COMMAND" "${CODEX_ARGS_ARR[@]}"
