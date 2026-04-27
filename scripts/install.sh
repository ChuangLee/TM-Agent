#!/usr/bin/env bash
# TM-Agent installer — turns the 5-step docs/deployment/README dance
# into a single interactive command. Handles:
#   - npm install + build + prune dev dependencies
#   - /etc/tm-agent/env with randomly generated TOKEN + PASSWORD
#   - systemd unit (installed, daemon-reloaded, enabled, started)
#   - optional --workspace-root flag stamped into EnvironmentFile
#
# Non-goals (on purpose):
#   - nginx + TLS: every environment's reverse proxy is different;
#     keep following docs/deployment/README.md for that leg.
#   - npm / node bootstrapping: assume a recent Node on PATH.
#
# Usage:
#   sudo ./scripts/install.sh                      # interactive
#   sudo ./scripts/install.sh --non-interactive    # accept all defaults
#   sudo ./scripts/install.sh --port 8767 \
#        --workspace-root /home/lichuang/repos \
#        --non-interactive
#
# Idempotent: rerunning on a system that already has /etc/tm-agent/env
# keeps the existing token + password (so the user's bookmarked URL
# survives reinstalls).

set -euo pipefail

# ── defaults ──────────────────────────────────────────────────────────
PORT=8767
NON_INTERACTIVE=0
WORKSPACE_ROOT=""
BASE_PATH=""
SERVICE_USER="${SUDO_USER:-root}"
INSTALL_DIR=""

# Color helpers. Degrade gracefully when stdout isn't a tty (e.g. logs).
if [ -t 1 ]; then
  C_BOLD=$'\033[1m' ; C_DIM=$'\033[2m' ; C_RED=$'\033[31m'
  C_GRN=$'\033[32m' ; C_YEL=$'\033[33m' ; C_BLU=$'\033[34m'
  C_RST=$'\033[0m'
else
  C_BOLD="" ; C_DIM="" ; C_RED="" ; C_GRN="" ; C_YEL="" ; C_BLU="" ; C_RST=""
fi

info()  { printf '%s→%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()    { printf '%s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
warn()  { printf '%s!%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
die()   { printf '%s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

usage() {
  cat <<EOF
TM-Agent installer

Options:
  --port <n>              Backend port (default 8767)
  --workspace-root <path> Cap the session wizard's directory picker here
                          (default: the service user's \$HOME)
  --base-path <prefix>    URL path prefix for subpath reverse-proxy deploys
                          (e.g. /tmux). Default empty = root-mount; see
                          ADR-0018 for nginx/caddy configuration.
  --service-user <name>   System user the service runs as
                          (default: \$SUDO_USER, else root)
  --non-interactive       Use defaults for everything, no prompts
  -h, --help              Show this help

Environment:
  Run as root. The script installs /etc/tm-agent/env (0600) and an
  /etc/systemd/system/tm-agent.service unit, then enables and starts it.
EOF
}

# ── parse args ────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --port)            shift; PORT="$1" ;;
    --workspace-root)  shift; WORKSPACE_ROOT="$1" ;;
    --base-path)       shift; BASE_PATH="$1" ;;
    --service-user)    shift; SERVICE_USER="$1" ;;
    --non-interactive) NON_INTERACTIVE=1 ;;
    -h|--help)         usage; exit 0 ;;
    *) die "unknown flag: $1" ;;
  esac
  shift
done

# ── preflight ─────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || die "must run as root (try: sudo $0)"

command -v node >/dev/null 2>&1 || die "node not found on PATH — install Node 20+ first"
command -v npm >/dev/null 2>&1 || die "npm not found on PATH"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found — this installer targets systemd hosts"
command -v openssl >/dev/null 2>&1 || die "openssl not found — needed to generate token/password"

# Install dir = the repo this script lives in (canonical absolute path).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[ -f "$INSTALL_DIR/package.json" ] || die "expected package.json at $INSTALL_DIR — run this from inside the cloned repo"

# Resolve service user $HOME for the default workspace root.
if [ -z "$WORKSPACE_ROOT" ]; then
  SERVICE_HOME="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"
  [ -n "$SERVICE_HOME" ] || die "cannot resolve home directory for user '$SERVICE_USER'"
  WORKSPACE_ROOT="$SERVICE_HOME"
fi

# ── interactive confirmation ──────────────────────────────────────────
printf '%s%sTM-Agent installer%s\n\n' "$C_BOLD" "$C_BLU" "$C_RST"
printf '%sInstall dir     %s %s\n' "$C_DIM" "$C_RST" "$INSTALL_DIR"
printf '%sPort            %s %s\n' "$C_DIM" "$C_RST" "$PORT"
printf '%sService user    %s %s\n' "$C_DIM" "$C_RST" "$SERVICE_USER"
printf '%sWorkspace root  %s %s\n' "$C_DIM" "$C_RST" "$WORKSPACE_ROOT"
printf '%sBase path       %s %s\n' "$C_DIM" "$C_RST" "${BASE_PATH:-<root>}"
printf '\n'

if [ "$NON_INTERACTIVE" -ne 1 ]; then
  printf '%sProceed?%s [Y/n] ' "$C_BOLD" "$C_RST"
  read -r reply
  case "$reply" in
    n|N|no|NO) die "aborted by user" ;;
  esac
fi

# ── build ─────────────────────────────────────────────────────────────
info "npm install (this can take a minute)"
( cd "$INSTALL_DIR" && npm install ) >/dev/null 2>&1 \
  || die "npm install failed — rerun without redirection to see errors"
ok "dependencies installed"

info "npm run build"
( cd "$INSTALL_DIR" && npm run build ) >/dev/null 2>&1 \
  || die "npm run build failed — rerun without redirection to see errors"
ok "frontend + backend built"

info "npm prune --omit=dev"
( cd "$INSTALL_DIR" && npm prune --omit=dev ) >/dev/null 2>&1 \
  || die "npm prune failed — rerun without redirection to see errors"
ok "dev dependencies pruned"

# ── env file ──────────────────────────────────────────────────────────
ENV_DIR="/etc/tm-agent"
ENV_FILE="$ENV_DIR/env"

install -d -m 700 -o root -g root "$ENV_DIR"

if [ -f "$ENV_FILE" ]; then
  warn "reusing existing $ENV_FILE (token + password preserved)"
  # Ensure workspace root is present — older installs won't have it.
  if ! grep -q '^TM_AGENT_WORKSPACE_ROOT=' "$ENV_FILE"; then
    printf 'TM_AGENT_WORKSPACE_ROOT=%s\n' "$WORKSPACE_ROOT" >> "$ENV_FILE"
    ok "appended TM_AGENT_WORKSPACE_ROOT=$WORKSPACE_ROOT"
  fi
  # Base path: update when the user passes --base-path explicitly,
  # preserve the existing value otherwise. Empty --base-path on an
  # already-configured host is treated as "no change" — to clear it,
  # edit the env file by hand.
  if [ -n "$BASE_PATH" ]; then
    if grep -q '^TM_AGENT_BASE_PATH=' "$ENV_FILE"; then
      sed -i "s|^TM_AGENT_BASE_PATH=.*|TM_AGENT_BASE_PATH=$BASE_PATH|" "$ENV_FILE"
      ok "updated TM_AGENT_BASE_PATH=$BASE_PATH"
    else
      printf 'TM_AGENT_BASE_PATH=%s\n' "$BASE_PATH" >> "$ENV_FILE"
      ok "appended TM_AGENT_BASE_PATH=$BASE_PATH"
    fi
  fi
  TOKEN=$(grep -E '^TM_AGENT_TOKEN=' "$ENV_FILE" | cut -d= -f2-)
  PASSWORD=$(grep -E '^TM_AGENT_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
else
  TOKEN=$(openssl rand -hex 16)
  PASSWORD=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)
  umask 077
  cat > "$ENV_FILE" <<EOF
TM_AGENT_TOKEN=$TOKEN
TM_AGENT_PASSWORD=$PASSWORD
TM_AGENT_WORKSPACE_ROOT=$WORKSPACE_ROOT
TM_AGENT_BASE_PATH=$BASE_PATH
EOF
  umask 022
  chmod 600 "$ENV_FILE"
  ok "wrote $ENV_FILE with freshly generated token + password"
fi

# ── systemd unit ──────────────────────────────────────────────────────
UNIT_FILE="/etc/systemd/system/tm-agent.service"
SERVICE_HOME_FOR_UNIT="$(getent passwd "$SERVICE_USER" | cut -d: -f6)"

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=TM-Agent web interface
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Environment=HOME=$SERVICE_HOME_FOR_UNIT
EnvironmentFile=$ENV_FILE
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/env node $INSTALL_DIR/dist/backend/cli.js --port $PORT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
ok "wrote $UNIT_FILE"

systemctl daemon-reload
systemctl enable tm-agent.service >/dev/null 2>&1
systemctl restart tm-agent.service

# Give it a moment to fail-fast if misconfigured.
sleep 1
if ! systemctl is-active --quiet tm-agent.service; then
  warn "tm-agent.service did not become active — inspect: journalctl -u tm-agent -n 50"
  die "service failed to start"
fi
ok "tm-agent.service is active on port $PORT"

# ── final summary ─────────────────────────────────────────────────────
printf '\n%s%sInstall complete.%s\n\n' "$C_BOLD" "$C_GRN" "$C_RST"
printf '  Open (localhost test):  %shttp://localhost:%s%s/?token=%s%s\n' \
  "$C_BOLD" "$PORT" "$BASE_PATH" "$TOKEN" "$C_RST"
printf '  Password prompt:        %s%s%s\n' "$C_BOLD" "$PASSWORD" "$C_RST"
printf '\n'
printf '  Next: put nginx + TLS in front of 127.0.0.1:%s.\n' "$PORT"
if [ -n "$BASE_PATH" ]; then
  printf '  Subpath deploy (%s) — template:\n' "$BASE_PATH"
  printf '  %sdocs/deployment/nginx.conf.example.subpath%s\n' "$C_DIM" "$C_RST"
else
  printf '  Template: %sdocs/deployment/nginx.conf.example%s\n' "$C_DIM" "$C_RST"
fi
printf '\n'
printf '  Logs:    journalctl -u tm-agent -f\n'
printf '  Restart: sudo systemctl restart tm-agent\n'
printf '  Env:    %s%s%s\n' "$C_DIM" "$ENV_FILE" "$C_RST"
printf '\n'
