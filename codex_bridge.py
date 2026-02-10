import os
import time
import asyncio
from dataclasses import dataclass
from typing import Dict, Optional

from dotenv import load_dotenv

from fastmcp.server import create_proxy
from fastmcp.client.transports import StdioTransport
from fastmcp.server.dependencies import get_context
from fastmcp.server.proxy import ProxyClient

load_dotenv()

@dataclass
class SessionEntry:
    client: ProxyClient
    last_used: float

# In-memory session map (good for local dev)
_sessions: Dict[str, SessionEntry] = {}
_sessions_lock = asyncio.Lock()

# Optional TTL cleanup
SESSION_TTL_SECS = int(os.getenv("BRIDGE_SESSION_TTL_SECS", "1800"))  # 30 min default


def _split_csv(value: str) -> list[str]:
    return [x.strip() for x in value.split(",") if x.strip()]


def _build_codex_env() -> dict:
    """
    Build the environment to pass to the Codex subprocess.
    STDIO servers do not inherit env by default, so we explicitly pass needed keys.
    """
    passthrough = _split_csv(os.getenv("CODEX_ENV_PASSTHROUGH", "PATH,HOME,USER"))
    env = {}
    for k, v in os.environ.items():
        if k in passthrough or k.startswith("XDG_") or k.startswith("CODEX_"):
            env[k] = v
    return env


def _new_codex_client() -> ProxyClient:
    codex_cmd = os.getenv("CODEX_COMMAND", "codex")
    codex_args = os.getenv("CODEX_ARGS", "mcp-server").split()
    codex_cwd = os.getenv("CODEX_CWD") or None

    transport = StdioTransport(
        command=codex_cmd,
        args=codex_args,
        cwd=codex_cwd,
        env=_build_codex_env(),
        keep_alive=True,  # reuse the same subprocess across connections :contentReference[oaicite:4]{index=4}
    )
    return ProxyClient(transport)


def _current_session_id() -> str:
    """
    Get the MCP session id for the current request, when available. :contentReference[oaicite:5]{index=5}
    Falls back to a single shared bucket if not available.
    """
    try:
        ctx = get_context()
        sid = getattr(ctx, "session_id", None)
        if isinstance(sid, str) and sid:
            return sid
    except Exception:
        pass
    return "global"


async def _cleanup_expired_sessions() -> None:
    """
    Best-effort cleanup loop. If the process is long-lived, this prevents unbounded growth.
    """
    while True:
        await asyncio.sleep(60)
        now = time.time()
        async with _sessions_lock:
            expired = [sid for sid, entry in _sessions.items() if (now - entry.last_used) > SESSION_TTL_SECS]
            for sid in expired:
                # Best-effort: dropping the client lets transports be GC'd;
                # for hard shutdown you can restart the bridge process.
                _sessions.pop(sid, None)


async def create_server():
    """
    Factory used by `fastmcp run ...:create_server` so setup always runs.
    """
    async def client_factory() -> ProxyClient:
        sid = _current_session_id()
        now = time.time()

        async with _sessions_lock:
            entry = _sessions.get(sid)
            if entry is None:
                entry = SessionEntry(client=_new_codex_client(), last_used=now)
                _sessions[sid] = entry
            else:
                entry.last_used = now
            return entry.client

    # FastMCP proxy server that forwards tools/resources/prompts from Codex
    proxy = create_proxy(client_factory=client_factory, name="codex-bridge")

    # Start cleanup task (optional)
    asyncio.create_task(_cleanup_expired_sessions())

    return proxy


# `fastmcp run` can target this factory:
# fastmcp run codex_bridge.py:create_server ...
