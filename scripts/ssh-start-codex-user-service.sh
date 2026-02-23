#!/usr/bin/env bash
set -euo pipefail

# SSH/remote entrypoint: set project context and trigger the static user unit.
# Usage: ssh-start-codex-user-service.sh <project_key> <project_path> [extra codex args...]

PROJECT_KEY="${1:-}"
PROJECT_PATH="${2:-${CODEX_PROJECT_PATH:-$HOME/src}}"
shift 2 || true
EXTRA_ARGS=("$@")

UID_NOW="$(id -u)"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/${UID_NOW}}"
LOCKFILE="${XDG_RUNTIME_DIR}/codex-remote-resume.lock"
SERVICE_NAME="codex-remote-resume.service"
RUNNER="/home/src404/src/codex-tunnel/scripts/run-codex-resume-user.sh"

if [[ -z "${PROJECT_PATH}" ]]; then
  echo "project path is required" >&2
  exit 2
fi

EXTRA_ARGS_QUOTED=""
for arg in "${EXTRA_ARGS[@]}"; do
  if [[ -n "${EXTRA_ARGS_QUOTED}" ]]; then
    EXTRA_ARGS_QUOTED+=" "
  fi
  EXTRA_ARGS_QUOTED+="$(printf "%q" "${arg}")"
done

mkdir -p "${XDG_RUNTIME_DIR}"
exec 9>"${LOCKFILE}"
flock -n 9 || {
  echo "resume trigger already in progress" >&2
  exit 1
}

if command -v app2unit >/dev/null 2>&1; then
  app2unit -T -t service -- \
    /usr/bin/env \
      CODEX_PROJECT_KEY="${PROJECT_KEY}" \
      CODEX_PROJECT_PATH="${PROJECT_PATH}" \
      CODEX_EXTRA_ARGS="${EXTRA_ARGS_QUOTED}" \
      "${RUNNER}"
  echo "started app2unit service project_key=${PROJECT_KEY} project_path=${PROJECT_PATH}"
  exit 0
fi

# Fallback: static user service
systemctl --user set-environment \
  CODEX_PROJECT_KEY="${PROJECT_KEY}" \
  CODEX_PROJECT_PATH="${PROJECT_PATH}" \
  CODEX_EXTRA_ARGS="${EXTRA_ARGS_QUOTED}"
systemctl --user start "${SERVICE_NAME}"
echo "started ${SERVICE_NAME} project_key=${PROJECT_KEY} project_path=${PROJECT_PATH}"
