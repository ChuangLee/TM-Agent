# Deployment

Reference deployment: single Linux host, systemd service bound to
`127.0.0.1:8767`, nginx reverse proxy with Let's Encrypt via acme.sh.
The three example files in this directory mirror what we run in
production.

## Fast path: one-liner (recommended)

`scripts/bootstrap.sh` clones the repo into `/opt/tm-agent` and hands
off to `scripts/install.sh` — which does the whole dance (npm install,
build, prune dev dependencies, random token+password,
`/etc/tm-agent/env`, systemd unit, enable + start):

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh | sudo bash
```

With args (note `-s --` — tells bash "end of shell flags, forward the
rest to the script"):

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh \
  | sudo bash -s -- --workspace-root /root/repos
```

Overridable via env: `TM_AGENT_REPO`, `TM_AGENT_REF`, `TM_AGENT_DIR`
(default `/opt/tm-agent`). Rerunning upgrades in place — `git pull`
to the requested ref, then re-exec the installer, which reuses the
existing env file so bookmarked URLs survive.

Security-conscious operators: inspect before executing —

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh -o bootstrap.sh
less bootstrap.sh
sudo bash bootstrap.sh
```

Skip ahead to step 4 (nginx + TLS) after the installer finishes.

### Fast path: in-repo

If you've already cloned manually, call the installer directly:

```bash
git clone https://github.com/ChuangLee/TM-Agent /opt/tm-agent
cd /opt/tm-agent
sudo ./scripts/install.sh --workspace-root ~/repos
```

The manual path below is kept for operators who want to own each step.

## Subpath deploy (ADR-0018)

If you don't have a spare subdomain and want to mount TM-Agent at
`https://host.example/tmux/` instead of `https://tmux.host.example/`,
add `--base-path /tmux` to the installer:

```bash
sudo ./scripts/install.sh --workspace-root ~/repos --base-path /tmux
```

Or from the one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh \
  | sudo bash -s -- --workspace-root /root/repos --base-path /tmux
```

Then use [`nginx.conf.example.subpath`](./nginx.conf.example.subpath) as
your nginx template. The prefix you put in nginx (`location /tmux/`)
and the prefix you pass to the installer (`--base-path /tmux`) must
match; the installer writes `TM_AGENT_BASE_PATH` into
`/etc/tm-agent/env` so the systemd unit picks it up on every restart.

## Manual one-time setup

### 1. Build and install

```bash
git clone https://github.com/ChuangLee/TM-Agent /opt/tm-agent
cd /opt/tm-agent
npm install
npm run build
npm prune --omit=dev
```

Build dependencies are needed on the target host unless you ship a prebuilt
`dist/`; `npm prune --omit=dev` keeps the deploy tree smaller after build.

### 2. Token + password env file

```bash
sudo install -d -m 700 /etc/tm-agent
TOKEN=$(openssl rand -hex 16)
PASS=$(openssl rand -base64 12 | tr -d '/+=' | cut -c1-16)
sudo tee /etc/tm-agent/env > /dev/null <<EOF
TM_AGENT_TOKEN=$TOKEN
TM_AGENT_PASSWORD=$PASS
EOF
sudo chmod 600 /etc/tm-agent/env
```

Record the values—the URL the user opens is
`https://tmux.example.com/?token=$TOKEN` and the password prompt takes
`$PASS`. They stay constant across restarts (see ADR on stable-URL env
vars).

### 3. systemd

```bash
sudo cp docs/deployment/systemd.service.example /etc/systemd/system/tm-agent.service
sudo systemctl daemon-reload
sudo systemctl enable --now tm-agent.service
sudo systemctl status tm-agent --no-pager
```

### 4. nginx + TLS

Assuming acme.sh is already configured on the box:

```bash
# Place the WebSocket upgrade map if you don't already have one:
sudo tee /etc/nginx/conf.d/00-websocket-upgrade.conf > /dev/null <<'EOF'
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
EOF

# Initial HTTP-only config for ACME challenge (edit example to match domain):
# place just the server { listen 80; ... } block first, reload nginx,
# then issue the cert:
sudo /root/.acme.sh/acme.sh --issue -d tmux.example.com --webroot /var/www/html -k ec-256

# Copy the HTTPS block from docs/deployment/nginx.conf.example and reload:
sudo cp docs/deployment/nginx.conf.example /etc/nginx/conf.d/tm-agent.conf
sudo nginx -t
sudo systemctl reload nginx
```

## Verification

```bash
curl -sk https://tmux.example.com/api/config | jq
# → {"passwordRequired":true,"scrollbackLines":1000,"pollIntervalMs":2500}
```

Open `https://tmux.example.com/?token=…` in a browser and enter the
password. You should land on the last attached tmux session (or a new
`main` if nothing was running).

## Updating

```bash
cd /opt/tm-agent
git pull
npm install              # only if package-lock changed
npm run build
npm prune --omit=dev
sudo systemctl restart tm-agent
```

## Running under a non-root user

The default service file runs as root to share root's tmux socket
(`/tmp/tmux-0/default`). If you want the service to manage a different
user's tmux:

```ini
[Service]
User=yourname
Environment=HOME=/home/yourname
```

`HOME` is required so tmux finds the right per-user socket directory.

## Troubleshooting

- Service won't start: `sudo journalctl -u tm-agent -f`
- `/api/config` returns 502: backend crashed or bound to the wrong
  interface. Check the service status.
- WebSocket closes immediately after auth: token/password mismatch.
  The env file and the browser URL must agree.
- Scrollback is empty on alt-screen apps (vim, htop, Claude Code TUI):
  this is tmux's alt-screen behavior, not a deployment bug.
  See `docs/adr/0004-native-scroll-via-virtual-container.md`.
