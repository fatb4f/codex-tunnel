# Remote Access Plan: Cloudflare Tunnel Reuse

## Decision
`codex-tunnel` is the standalone remote-access subsystem.

## Source Context
- Existing Cloudflare zone and tunnel footprint from previous fastmcp deployment
- Existing WAN/router path: reuse current endpoint used for fastmcp deployment (kept outside git)

## Objective
Provide phone-triggered Codex resume access over Cloudflare Tunnel without exposing inbound SSH directly.

## Architecture
1. Edge ingress
- Cloudflare Tunnel (`cloudflared`)
- Cloudflare Access policy at edge

2. Local origin
- `codex-tunnel` Node service on `127.0.0.1:8000`
- Remote endpoint: `POST /remote/resume`
- Health endpoint: `GET /remote/health`
- No MCP endpoint in this phase

3. Trigger execution
- Validate bearer auth token (`REMOTE_ACCESS_TOKEN`)
- Restrict `project_path` to `REMOTE_PROJECT_ROOT`
- Execute `REMOTE_RESUME_COMMAND` (default `/home/src404/.local/bin/xx.sh`)
- Command handles project-scoped locking and resume flow

4. Logging and audit
- Append JSONL records to `REMOTE_RUN_LOG_PATH`
- Record request id, project path/key, command, exit status, and redacted output tails

## Reuse Strategy
1. Domain/tunnel
- Keep existing zone/Cloudflare account used by prior fastmcp deployment
- Add dedicated path or host for remote trigger use

2. Router/WAN
- Reuse existing WAN endpoint and router forwarding/tunnel setup
- Prefer tunnel-origin connectivity instead of direct inbound exposure

3. Security controls
- Require Access policy + bearer auth
- Keep local command surface restricted
- Short session TTL and narrow scopes

## Implementation Tasks
- [x] Add remote trigger endpoint to bridge server
- [x] Add path-boundary and bearer-token enforcement
- [x] Add structured remote-run JSONL logging
- [x] Add Cloudflare Access + SSH cert-auth runbook
- [ ] Add replay tests for idempotency/lock semantics at trigger wrapper layer

## Non-Goals
- Full remote desktop
- Telegram/bot trigger channel
- Early-boot (`dropbear + dracut`) access path
