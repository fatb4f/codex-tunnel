# SSHD Certificate Auth + Cloudflare Access Policies

## Goal
Use Cloudflare Tunnel/Access as the internet edge while enforcing strong local SSH auth with OpenSSH certificates.

## Components
1. `cloudflared` tunnel ingress:
- `ssh.example.com` -> `ssh://localhost:22`
- `codex-trigger.example.com` -> `http://127.0.0.1:8000`

2. Cloudflare Access:
- Access app for SSH hostname.
- Access app for trigger API hostname.

3. Local `sshd` certificate trust:
- `TrustedUserCAKeys` in sshd config.
- `AuthorizedPrincipalsFile` mapping local users to allowed principals.

## Local Setup (sshd cert auth)

Artifacts in this repo:
- `config/sshd/50-codex-tunnel-certauth.conf`
- `config/sshd/auth_principals/src404`
- `scripts/install_sshd_cert_auth.sh`

Install (root):

```bash
sudo /home/src404/src/codex-tunnel/scripts/install_sshd_cert_auth.sh \
  --ca-pub /path/to/trusted_user_ca_keys.pub
```

This installs:
- `/etc/ssh/sshd_config.d/50-codex-tunnel-certauth.conf`
- `/etc/ssh/trusted_user_ca_keys.pub`
- `/etc/ssh/auth_principals/src404`

## Cloudflare Tunnel Config

Reference:
- `config/cloudflared/config.example.yml`

Deploy:

```bash
sudo install -m 0644 /home/src404/src/codex-tunnel/config/cloudflared/config.example.yml /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

## Cloudflare Access Policies

### App A: SSH (`ssh.example.com`)
- Type: Self-hosted / SSH
- Include: explicit allowlist (emails/groups)
- Require: device posture (if available), short session duration
- Deny: everyone else
- Optional: MFA requirements once hardware key rollout is ready

### App B: Trigger API (`codex-trigger.example.com`)
- Type: Self-hosted web app
- Restrict path:
  - Allow only `POST /remote/resume`
  - Allow `GET /remote/health` for diagnostics (optional)
- Include: explicit allowlist (or service identity)
- Require: short session duration + Access enforcement
- Also require local bearer token (`REMOTE_ACCESS_TOKEN`) at origin

## SSH Certificate Flow
1. User has SSH keypair.
2. Key is signed by your SSH CA with principal(s): `src404`, `codex-remote`.
3. Client connects through Cloudflare Access SSH.
4. `sshd` validates certificate against `TrustedUserCAKeys`.
5. Principal is authorized via `/etc/ssh/auth_principals/src404`.

## Recommended Hardening
- Keep `PasswordAuthentication no`.
- Keep `PermitRootLogin no`.
- Use short certificate validity windows.
- Prefer forced command for automation-only keys.
- Keep Cloudflare Access policies deny-by-default.

