# Security Policy

## Supported Versions

TM-Agent is pre-1.0. Security fixes land on `main` and are released in the
next patch version. There is no extended support window for older minor
versions yet.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security problems.**

Please use one of these private channels:

1. **Preferred:** GitHub's [private vulnerability reporting](https://github.com/ChuangLee/TM-Agent/security/advisories/new).
2. Email the maintainers via the address listed on the GitHub profile of the
   `TM-Agent` owner.

Include in your report:

- A description of the issue and its impact.
- Steps to reproduce, ideally a minimal proof-of-concept.
- Affected versions / commits.
- Any suggested mitigation.

We will acknowledge your report within **3 business days** and aim to ship a
fix or a documented mitigation within **30 days** for confirmed
vulnerabilities. Coordinated disclosure is appreciated; please give us a
chance to ship the fix before going public.

## Threat Model

TM-Agent is a single-user web frontend for tmux that exposes a long-lived
PTY over a WebSocket. The threat model it aims to address:

| In scope                                                               | Out of scope                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Unauthenticated network attackers reaching the WS / REST endpoints.    | A malicious user with shell access on the host.                  |
| Stolen URLs (token leaked via referer, screen share, browser history). | An attacker who already has the contents of `/etc/tm-agent/env`. |
| CSRF and clickjacking against the web UI.                              | Side-channel attacks on the host kernel / tmux itself.           |
| Plaintext snooping over the wire.                                      | Multi-tenant isolation between users (this is single-user).      |

### Authentication

- Every WebSocket connection requires **both** a query-string token and a
  password sent in the auth handshake.
- Token comparison and password comparison are constant-time.
- Tokens are minted with `openssl rand` at install time and persisted to
  `/etc/tm-agent/env` (mode 600, root-owned).

### Network exposure

- The backend binds `127.0.0.1` by default.
- Public deployments **must** terminate TLS in a reverse proxy (nginx
  templates are provided in `docs/deployment/`).
- Do not expose the backend port directly to the public internet.

### Secret handling

- Secrets are loaded via `EnvironmentFile=` in the systemd unit, never as
  command-line args (so they do not appear in `ps`).
- Non-interactive startup logs redact the token and password.
- The browser keeps the password in memory only; it is not persisted to
  `localStorage`.

### What we don't promise (yet)

- No 2FA / hardware-key support — token+password is the only factor.
- No per-session ACLs — anyone with the token can attach to any tmux session
  on the host.
- No audit trail of who did what — tmux itself does not record this.

If your deployment needs any of the above, please open a discussion before
relying on TM-Agent for that use case.

## Hardening Checklist for Operators

- [ ] Reverse-proxy with TLS (Let's Encrypt or similar).
- [ ] Bind the backend to `127.0.0.1` (the default; do not change it).
- [ ] Keep `/etc/tm-agent/env` at mode `600`, owned by `root` (or the
      service user only).
- [ ] Rotate the token if the URL has been shared, screenshotted, or pasted
      into a chat tool.
- [ ] Run the systemd unit as a dedicated, unprivileged user when feasible.
- [ ] Keep Node.js, tmux, and OS packages patched.
