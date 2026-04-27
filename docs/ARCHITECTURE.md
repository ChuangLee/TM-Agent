# Technical Architecture

> Audience: engineers about to change this repo. This document describes the current public-preview architecture; historical sequencing lives in [`ROADMAP.md`](./ROADMAP.md) and `docs/adr/`.

## 1. System Overview

```
Browser
├── React 19 SPA (Vite)
│   ├── App shell: responsive mobile drawer / desktop sidebar layout
│   ├── Terminal surface: xterm.js buffer + custom React chrome
│   ├── Compose bar: IME-safe prompt injection + attachment upload
│   ├── Sessions / Files / Sysinfo / Direct Mode / Key Overlay
│   └── Services: Control WS, Terminal WS, HTTP APIs
│
│      /ws/control        JSON protocol: auth, tmux state, slot control
│      /ws/terminal       PTY byte stream + resize/read/write controls
│      /api/*             config, files, shell history, workspace picker
│
Node backend
├── Express + ws
│   ├── AuthService: token + optional password, constant-time checks
│   ├── ControlWebSocket: state, session mutations, slot attach routing
│   ├── TerminalRuntime: one PTY attachment per client/slot
│   ├── TmuxStateMonitor: snapshot + JSON Patch delta broadcasts
│   ├── Files routes: pane-cwd-rooted file browser and upload/download
│   ├── Fs picker routes: workspace-root sandbox for new session cwd
│   └── Sysinfo sampler: Linux CPU / memory / load samples
│
tmux server
└── Sessions / windows / panes / grouped client sessions
```

The backend started as a fork of `DagsHub/tmux-mobile` and still uses the same sound transport foundation: `ws`, `node-pty`, tmux CLI execution, and token/password auth. TM-Agent extends that foundation with slot-aware routing, file APIs, sysinfo, workspace-root install UX, subpath deployment support, and a fully rewritten frontend.

## 2. Backend Boundaries

| Area             | Files                                            | Responsibility                                              |
| ---------------- | ------------------------------------------------ | ----------------------------------------------------------- |
| CLI/config       | `src/backend/cli.ts`, `config.ts`, `util/env.ts` | env parsing, token/password setup, port/base-path setup     |
| HTTP/WS server   | `src/backend/server.ts`                          | Express app, WebSocket upgrade, SPA/static serving          |
| Auth             | `src/backend/auth/`                              | token/password validation and HTTP auth middleware          |
| tmux gateway     | `src/backend/tmux/`                              | CLI execution, snapshot parsing, tmux mutations             |
| PTY runtime      | `src/backend/pty/`                               | `node-pty` adapter and per-client attach lifecycle          |
| State monitor    | `src/backend/state/`                             | periodic tmux snapshots and delta publication               |
| File browser     | `src/backend/files/`                             | pane-cwd-rooted list/meta/raw/download/delete/rename/upload |
| Workspace picker | `src/backend/fs-picker/`                         | sandboxed directory browsing and mkdir                      |
| Shell history    | `src/backend/shell-history/`                     | readonly recent shell history suggestions                   |
| Sysinfo          | `src/backend/sysinfo/`                           | Linux `/proc` parsing and rolling samples                   |

Backend code should keep tmux as the source of truth. Do not mirror long-lived session/window/pane state outside `TmuxStateMonitor` unless there is a concrete latency or UX reason, and document that reason in an ADR.

## 3. Frontend Boundaries

```
src/frontend/
├── app/                 # App composition, responsive layout, feature wiring
├── components/          # small shared UI primitives
├── features/
│   ├── action-panel/    # state-aware action cards
│   ├── auth/            # password/token UX
│   ├── compose/         # prompt input, slash menu, attachments
│   ├── direct-mode/     # raw keyboard-to-PTY mode
│   ├── files/           # sidebar file browser and previews
│   ├── key-overlay/     # mobile soft-key layer
│   ├── sessions/        # session list, rail, drawers, new session wizard
│   ├── shell/           # TopBar and shell chrome
│   ├── shell-state/     # pane-state classifier for agent/TUI affordances
│   ├── sysinfo/         # sidebar footer sparklines
│   └── terminal/        # MultiSurface, SlotFrame, xterm lifecycle
├── hooks/               # control session, slot shortcuts, viewport helpers
├── i18n/                # locale resources and language detection
├── services/            # WS clients and HTTP API clients
├── stores/              # Zustand domain stores
└── styles/              # design tokens and terminal layout CSS
```

State is split by domain with Zustand. The highest-risk stores are:

| Store                      | Role                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `auth-store`               | token/password/auth phase                                        |
| `sessions-store`           | tmux snapshot, attached base sessions, managed-session filtering |
| `layout-store`             | desktop slot layout and focused slot                             |
| `terminal-store`           | per-slot terminal lifecycle metadata                             |
| `file-listings-store`      | pane-rooted directory cache                                      |
| `shell-state-store`        | current pane classifier state                                    |
| `sysinfo-store`            | rolling system stats samples                                     |
| `ui-store` / `sheet-store` | drawers, sheets, toasts, and transient chrome state              |

Feature code should consume its own domain store directly. Cross-feature coupling should go through `app/` wiring or an explicit shared service, not ad-hoc imports between feature folders.

## 4. Wire Protocol

Source of truth is [`src/shared/protocol.ts`](../src/shared/protocol.ts).

Control WebSocket:

- Client sends `auth` with token/password and optional capabilities.
- Server returns `auth_ok` or `auth_error`.
- Server publishes `tmux_state` snapshots; delta-capable clients also receive `tmux_state_delta`.
- Client mutates tmux with messages such as `select_session`, `new_session`, `rename_session`, `kill_session`, `new_window`, `select_window`, `split_pane`, `select_pane`, `zoom_pane`, `send_compose`, `send_raw`, and `detach_slot`.
- Desktop tiling uses `slot` ids. Missing slot means slot `0`, preserving single-pane compatibility.
- `attached`, `scrollback`, `session_picker`, `system_stats`, `info`, and `error` are server events.

Terminal WebSocket:

- Carries authenticated PTY bytes for a specific `(clientId, slot)`.
- JSON control frames handle resize/read/write.
- Direct Mode writes raw bytes through the same PTY path; Compose Mode uses tmux buffer paste semantics.

HTTP APIs:

- `GET /api/config`: public client config needed before auth.
- `/api/files/*`: authenticated pane-cwd-rooted file operations.
- `/api/fs-picker/*`: authenticated workspace-root sandbox for new session cwd selection.
- `/api/shell-history`: authenticated shell-history suggestions.

All routes are mounted under `basePath` when deployed below a subpath such as `/tmux`.

## 5. Security Model

- Bind to `127.0.0.1` by default; put nginx/Caddy/another TLS proxy in front for production.
- Require the URL token for all authenticated APIs and WebSockets; optionally require password as a second factor.
- Keep persistent credentials in `/etc/tm-agent/env` with mode `600` when installed through `scripts/install.sh`.
- Never expose arbitrary filesystem roots through Files. File operations are rooted at the active pane cwd and guarded against symlink escape/path traversal.
- New-session cwd browsing is separately sandboxed by `--workspace-root`.
- Static asset misses under `/assets/*` return `404`, not the SPA fallback, so module scripts never get HTML with the wrong MIME type.

## 6. Build, Test, And Deploy

```
package.json
├── src/backend/   → tsc → dist/backend/
├── src/frontend/  → vite → dist/frontend/
└── src/shared/    → imported by both
```

Primary commands:

- `npm run dev`: backend `tsx watch` + Vite dev server with `/ws/*` and `/api/*` proxying.
- `npm run build`: Vite frontend build, then backend TypeScript build.
- `npm run typecheck`: backend and frontend `tsc --noEmit`.
- `npm run lint`: ESLint over the repo.
- `npm test`: Vitest unit/integration tests.
- `npm run test:e2e`: production build plus Playwright.

Deployment entry points:

- `scripts/bootstrap.sh`: remote curl entrypoint; clones/updates `/opt/tm-agent`.
- `scripts/install.sh`: idempotent local installer; builds, prunes dev deps, writes env, installs systemd unit.
- `docs/deployment/nginx.conf.example`: root-domain reverse proxy.
- `docs/deployment/nginx.conf.example.subpath`: subpath reverse proxy.

## 7. Constraints And Tradeoffs

- tmux remains the session authority. TM-Agent adds web control, not a replacement process supervisor.
- Alt-screen applications still own their own history semantics. TM-Agent can seed and scroll tmux/xterm buffers, but it does not invent full transcripts for apps that do not emit one.
- File APIs are intentionally local to the server where tmux runs. Multi-host orchestration is out of scope for the current public preview.
- Mobile Direct Mode is intentionally absent because soft keyboards cannot reliably express physical modifier chords.
- Agent output is treated as PTY output. Agent-specific affordances live around the terminal, not inside a structured parser for the agent stream.
