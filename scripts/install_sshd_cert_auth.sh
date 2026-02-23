#!/usr/bin/env bash
set -euo pipefail

# Install codex-tunnel SSH certificate auth config into /etc/ssh.
#
# Usage:
#   sudo ./scripts/install_sshd_cert_auth.sh \
#     --ca-pub /path/to/trusted_user_ca_keys.pub

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

CA_PUB=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ca-pub)
      CA_PUB="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [[ -z "${CA_PUB}" || ! -f "${CA_PUB}" ]]; then
  echo "--ca-pub is required and must point to an existing file" >&2
  exit 2
fi

install -d -m 0755 /etc/ssh/sshd_config.d
install -d -m 0755 /etc/ssh/auth_principals

install -m 0644 "${REPO_ROOT}/config/sshd/50-codex-tunnel-certauth.conf" \
  /etc/ssh/sshd_config.d/50-codex-tunnel-certauth.conf
install -m 0644 "${CA_PUB}" /etc/ssh/trusted_user_ca_keys.pub
install -m 0644 "${REPO_ROOT}/config/sshd/auth_principals/src404" \
  /etc/ssh/auth_principals/src404

sshd -t
systemctl reload sshd

echo "sshd cert-auth config installed and reloaded"
