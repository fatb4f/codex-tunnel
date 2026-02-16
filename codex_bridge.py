import os
import time
import asyncio
import itertools
import logging
from dataclasses import dataclass
from typing import Dict
from pathlib import Path
from logging.handlers import RotatingFileHandler

from dotenv import load_dotenv

from fastmcp.client.transports import StdioTransport
from fastmcp.server.dependencies import get_context
from fastmcp.server.proxy import FastMCPProxy, ProxyClient

load_dotenv()


def _init_bridge_logging() -> logging.Logger:
    logger = logging.getLogger("codex_bridge")
    if logger.handlers:
        return logger

    level = os.getenv("BRIDGE_LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))

    log_to_file = os.getenv("BRIDGE_LOG_TO_FILE", "1").lower() in {"1", "true", "yes"}
    if log_to_file:
        xdg_state = os.getenv("XDG_STATE_HOME", str(Path.home() / ".local/state"))
        default_path = Path(xdg_state) / "codex" / "codex-fastmcp" / "bridge.log"
        log_path = Path(os.getenv("BRIDGE_LOG_PATH", str(default_path)))
        log_path.parent.mkdir(parents=True, exist_ok=True)

        handler = RotatingFileHandler(log_path, maxBytes=5_000_000, backupCount=5, encoding="utf-8")
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
        logger.addHandler(handler)

    return logger


LOG = _init_bridge_logging()

@dataclass
class SessionEntry:
    client: ProxyClient
    last_used: float

# In-memory session map (good for local dev)
_sessions: Dict[str, SessionEntry] = {}
_sessions_lock = asyncio.Lock()
_anon_sid_counter = itertools.count(1)

# Optional TTL cleanup
SESSION_TTL_SECS = int(os.getenv("BRIDGE_SESSION_TTL_SECS", "1800"))  # 30 min default


def _split_csv(value: str) -> list[str]:
    return [x.strip() for x in value.split(",") if x.strip()]


def _flag(name: str, default: str = "0") -> bool:
    return os.getenv(name, default).lower() in {"1", "true", "yes"}


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
    LOG.debug("new_codex_client cmd=%s cwd=%s", codex_cmd, codex_cwd)

    # Single-shot mode is the safe default for ChatGPT-driven calls.
    single_shot = _flag("BRIDGE_SINGLE_SHOT", "1")
    keep_alive = False if single_shot else _flag("BRIDGE_KEEP_ALIVE", "0")
    transport = StdioTransport(
        command=codex_cmd,
        args=codex_args,
        cwd=codex_cwd,
        env=_build_codex_env(),
        keep_alive=keep_alive,
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
            LOG.debug("session_id from context sid=%s", sid)
            return sid
    except Exception:
        LOG.exception("failed to read context session_id")
        pass

    # Global fallback can cause cross-request session collisions.
    if _flag("BRIDGE_ALLOW_GLOBAL_FALLBACK", "0"):
        LOG.warning("using global session fallback")
        return "global"
    sid = f"anon-{next(_anon_sid_counter)}"
    LOG.debug("using anonymous session sid=%s", sid)
    return sid


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
        # In single-shot mode, always use a fresh upstream client.
        if _flag("BRIDGE_SINGLE_SHOT", "1"):
            LOG.debug("client_factory single_shot=1 creating fresh client")
            return _new_codex_client()

        reuse_mode = _flag("BRIDGE_REUSE_SESSIONS", "0")
        if not reuse_mode:
            LOG.debug("client_factory reuse_mode=0 creating fresh client")
            return _new_codex_client()

        sid = _current_session_id()
        now = time.time()

        async with _sessions_lock:
            entry = _sessions.get(sid)
            if entry is None:
                LOG.info("client_factory create session sid=%s", sid)
                entry = SessionEntry(client=_new_codex_client(), last_used=now)
                _sessions[sid] = entry
            else:
                LOG.info("client_factory reuse session sid=%s", sid)
                entry.last_used = now
            return entry.client

    # FastMCP proxy server that forwards tools/resources/prompts from Codex
    proxy = FastMCPProxy(client_factory=client_factory, name="codex-bridge")
    LOG.info(
        "bridge start single_shot=%s reuse_sessions=%s keep_alive=%s",
        _flag("BRIDGE_SINGLE_SHOT", "1"),
        _flag("BRIDGE_REUSE_SESSIONS", "0"),
        _flag("BRIDGE_KEEP_ALIVE", "0"),
    )

    # Start cleanup only if pooled sessions are enabled.
    if not _flag("BRIDGE_SINGLE_SHOT", "1") and _flag("BRIDGE_REUSE_SESSIONS", "0"):
        asyncio.create_task(_cleanup_expired_sessions())

    return proxy


# `fastmcp run` can target this factory:
# fastmcp run codex_bridge.py:create_server ...
