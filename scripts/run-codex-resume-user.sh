#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${CODEX_PROJECT_PATH:-$HOME/src}"
EXTRA_ARGS="${CODEX_EXTRA_ARGS:-}"

if [[ ! -d "${PROJECT_PATH}" ]]; then
  echo "invalid project path: ${PROJECT_PATH}" >&2
  exit 2
fi

LAUNCH_SNIPPET='
set -euo pipefail
cd "${CODEX_PROJECT_PATH}"
if [[ -n "${CODEX_EXTRA_ARGS:-}" ]]; then
  eval "set -- ${CODEX_EXTRA_ARGS}"
else
  set --
fi
exec codex resume --last "$@"
'

if command -v xdg-terminal-exec >/dev/null 2>&1; then
  exec /usr/bin/env \
    CODEX_PROJECT_PATH="${PROJECT_PATH}" \
    CODEX_EXTRA_ARGS="${EXTRA_ARGS}" \
    xdg-terminal-exec -- /usr/bin/env bash -lc "${LAUNCH_SNIPPET}"
fi

# Fallback for non-desktop sessions.
exec /usr/bin/env \
  CODEX_PROJECT_PATH="${PROJECT_PATH}" \
  CODEX_EXTRA_ARGS="${EXTRA_ARGS}" \
  bash -lc "${LAUNCH_SNIPPET}"
