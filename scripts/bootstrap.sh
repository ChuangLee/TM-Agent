#!/usr/bin/env bash
# TM-Agent remote bootstrap — designed to be piped from curl:
#
#   curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh | sudo bash
#
# With args (note the `-s --`, which tells bash "end of shell flags,
# forward the rest to the script"):
#
#   curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh \
#     | sudo bash -s -- --workspace-root /root/repos
#
# This script is intentionally thin: it only does what install.sh
# *can't* do when running from stdin — namely, get the repo onto the
# box. Once the clone is on disk it execs scripts/install.sh with the
# forwarded args, so all the real logic (build, env, systemd,
# idempotency) lives in exactly one place.
#
# Overridable via env:
#   TM_AGENT_REPO=<git url>        default: the canonical GitHub repo
#   TM_AGENT_REF=<branch|tag|sha>  default: main
#   TM_AGENT_DIR=<abs path>        default: /opt/tm-agent

set -euo pipefail

REPO="${TM_AGENT_REPO:-https://github.com/ChuangLee/TM-Agent.git}"
REF="${TM_AGENT_REF:-main}"
DIR="${TM_AGENT_DIR:-/opt/tm-agent}"

if [ -t 1 ]; then
  C_BOLD=$'\033[1m' ; C_DIM=$'\033[2m' ; C_RED=$'\033[31m'
  C_GRN=$'\033[32m' ; C_BLU=$'\033[34m' ; C_RST=$'\033[0m'
else
  C_BOLD="" ; C_DIM="" ; C_RED="" ; C_GRN="" ; C_BLU="" ; C_RST=""
fi

info() { printf '%s→%s %s\n' "$C_BLU" "$C_RST" "$*"; }
ok()   { printf '%s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
die()  { printf '%s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "must run as root (try: curl … | sudo bash)"
command -v git >/dev/null 2>&1 || die "git not found — install git first"

printf '%s%sTM-Agent bootstrap%s\n' "$C_BOLD" "$C_BLU" "$C_RST"
printf '%sRepo%s %s @ %s\n' "$C_DIM" "$C_RST" "$REPO" "$REF"
printf '%sDir %s %s\n\n' "$C_DIM" "$C_RST" "$DIR"

if [ -d "$DIR/.git" ]; then
  info "updating existing checkout at $DIR"
  git -C "$DIR" fetch --depth 1 origin "$REF"
  git -C "$DIR" checkout -q "$REF"
  git -C "$DIR" reset --hard "origin/$REF" 2>/dev/null || git -C "$DIR" reset --hard FETCH_HEAD
  ok "checkout updated to $(git -C "$DIR" rev-parse --short HEAD)"
elif [ -e "$DIR" ]; then
  die "$DIR exists but is not a git checkout — move it aside or set TM_AGENT_DIR"
else
  info "cloning $REPO → $DIR"
  install -d -m 755 "$(dirname "$DIR")"
  git clone --depth 1 --branch "$REF" "$REPO" "$DIR"
  ok "cloned $(git -C "$DIR" rev-parse --short HEAD)"
fi

INSTALLER="$DIR/scripts/install.sh"
[ -x "$INSTALLER" ] || chmod +x "$INSTALLER" 2>/dev/null || true
[ -f "$INSTALLER" ] || die "installer missing at $INSTALLER — did the repo layout change?"

# Hand off. install.sh handles the rest (build, env, systemd) and is
# idempotent by design, so re-running bootstrap is a safe upgrade path.
printf '\n'
exec bash "$INSTALLER" "$@"
