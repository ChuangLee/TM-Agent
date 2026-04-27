# Changelog

All notable changes to TM-Agent are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Public documentation now frames TM-Agent as a precision console for
  supervising multiple AI agents directly through tmux.
- The one-line installer now bootstraps `git`, tmux, openssl, native build
  tools, and Node.js 20+ on common Linux distributions before building the app.

### Security

- Redact token/password from non-interactive startup logs.
- Replace browser password persistence with an HttpOnly session cookie and
  clear legacy `localStorage` keys.
- Remove skip-permission agent commands from built-in presets and shell
  suggestions.

## [0.1.0] - 2026-04-26

First public, open-source-ready release. Forked from
[tmux-mobile](https://github.com/DagsHub/tmux-mobile); the backend and auth
model are inherited and the frontend is a from-scratch touch-first rewrite.

### Added

- **Touch-first frontend** — React 19 + Tailwind v4 + headless `xterm.js`
  rendered through a custom React DOM renderer (ADR-0004, ADR-0005).
- **Action-first mobile UI** — shell-state classifier drives an action card
  band; idle / editor / pager / password / repl states each have a tailored
  card layout (ADR-0006).
- **Compose bar input model** — single text input handles IME, history, and
  `paste-buffer`-based send pipeline; mouse is not forwarded to tmux.
- **Session identity & switcher** — server reports the real base session;
  sidebar `aria-current` and TopBar label stay in sync (ADR-0007).
- **Smart compose completion** (ADR-0009).
- **Unified session switcher** + **multi-pane desktop tiling** (ADR-0010,
  ADR-0013).
- **Sidebar system status** + **file panel** (ADR-0011, ADR-0012).
- **New-session wizard** with cwd + startup command + custom command library
  (ADR-0014).
- **Periodic WS optimizations** — sysinfo dedup, JSON Patch tmux_state
  deltas, coalesced forcePublish (ADR-0015).
- **i18n** — i18next bootstrap, 7-locale scaffolding, language switcher
  (ADR-0016).
- **Workspace root sandbox** + one-shot installer (`scripts/install.sh`,
  `scripts/bootstrap.sh`) (ADR-0017).
- **Subpath deploy** — runtime base-path injection, all REST/WS paths now
  relative (ADR-0018).
- **CI** — Prettier check, ESLint, typecheck, Vitest unit suite, build, all
  on pushes and PRs to `main`.

### Security

- WebSocket and REST connections require a constant-time-compared token plus
  password handshake (inherited from upstream and retained).
- Backend binds `127.0.0.1` by default; public deployments terminate TLS in a
  reverse proxy.
- Secrets load via `EnvironmentFile` so they never appear in `ps` or logs.

[Unreleased]: https://github.com/ChuangLee/TM-Agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ChuangLee/TM-Agent/releases/tag/v0.1.0
