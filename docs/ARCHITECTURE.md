# Technical Architecture

> Audience: engineers (including future Claude sessions) about to write code in this repo. Skim the section headings before diving in.

## 1. System overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Browser (phone / tablet / desktop)                                 │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ React SPA (Vite build)                                        │  │
│  │                                                               │  │
│  │  ┌─────────┐  ┌──────────────┐  ┌─────────┐  ┌─────────────┐  │  │
│  │  │AppShell │  │  Features    │  │  Hooks  │  │  Services   │  │  │
│  │  │ TopBar  │  │  sessions    │  │ useWS   │  │ ControlWS   │  │  │
│  │  │ Surface │──│  panes       │──│ useDrag │──│ TerminalWS  │  │  │
│  │  │ Compose │  │  history     │  │ useAuth │  │ ConfigAPI   │  │  │
│  │  │ Drawers │  │  commands    │  │         │  │             │  │  │
│  │  └─────────┘  └──────────────┘  └─────────┘  └─────────────┘  │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                    ▲              ▲                                 │
│                    │ /ws/control  │ /ws/terminal                    │
│                    │ JSON msgs    │ raw PTY bytes + JSON ctrl       │
└────────────────────┼──────────────┼─────────────────────────────────┘
                     │              │
┌────────────────────┼──────────────┼─────────────────────────────────┐
│  Node backend (ported from tmux-mobile, mostly unchanged)           │
│  ┌─────────────────┴──────────────┴──────────────────────────────┐  │
│  │ Express + ws                                                  │  │
│  │   - AuthService (token + optional password, constant-time)    │  │
│  │   - ControlWebSocket  ← tmux state, mutations, auth           │  │
│  │   - TerminalWebSocket ← PTY stdout/stdin bridge               │  │
│  │   - TmuxStateMonitor  ← periodic snapshot broadcaster         │  │
│  └────────────────────┬─────────────────────────────────────────┘   │
│                       │                                             │
│  ┌──────────────┐  ┌──┴─────────────┐  ┌─────────────────────────┐  │
│  │ TmuxGateway  │  │ TerminalRuntime│  │ PtyFactory (node-pty)   │  │
│  │  (tmux CLI   │  │  (per-client   │  │                         │  │
│  │  executor)   │  │  attach runtime│  │                         │  │
│  └──────┬───────┘  └──────┬─────────┘  └────────────┬────────────┘  │
│         │                 │                         │               │
└─────────┼─────────────────┼─────────────────────────┼───────────────┘
          │ spawns / queries│ spawns tmux attach PTY  │
          ▼                 ▼                         ▼
       ┌──────────────────────────────────────────────────┐
       │                tmux server                       │
       │  sessions / windows / panes / grouped attachments│
       └──────────────────────────────────────────────────┘
```

## 2. What we inherit from tmux-mobile

The backend is ported almost verbatim. The pieces:

| Module                     | Role                                        | Change needed                                                             |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `src/backend/auth/`        | Token + password auth, constant-time verify | None                                                                      |
| `src/backend/cloudflared/` | Optional quick-tunnel                       | Drop for v1 (we use nginx)                                                |
| `src/backend/pty/`         | `node-pty` adapter, `TerminalRuntime`       | None                                                                      |
| `src/backend/tmux/`        | `TmuxCliExecutor`, `FakeTmuxGateway`        | Small additions (session rename, multi-session snapshot)                  |
| `src/backend/state/`       | `TmuxStateMonitor` polling broadcaster      | None                                                                      |
| `src/backend/server.ts`    | Control + terminal WS endpoints             | Minor: new API routes (see §6)                                            |
| `src/backend/cli.ts`       | CLI entry, env loading                      | Port; keep env-var token/password support added during tmux-mobile deploy |

We do **not** inherit the React frontend. It is rewritten.

## 3. Frontend architecture

### 3.1 Shell

`AppShell` owns global layout and mounts features. It does **not** own business state.

```
AppShell
├── TopBar                (buttons: sessions, freeze, title, keys, command, more)
├── Surface               (virtual-scroll container; ADR-0004)
│   └── .scroller         (native overflow-y:auto; kinetic scroll lives here)
│       ├── .spacer       (height = scrollback line count × cellHeight)
│       └── .viewport     (sticky top:0; one visible window)
│           ├── LiveLayer       xterm.js canvas/webgl renderer
│           ├── ScrollMirror    DOM shadow of visible window (ANSI→HTML, native select)
│           └── FreezeLayer     on-demand DOM snapshot (ADR-0003)
├── SmartKeysBar          (collapsible, toggled from TopBar)
├── ComposeBar            (textarea + send)
├── SessionDrawer         (mobile overlay / desktop sidebar)
└── CommandSheet          (bottom sheet for tmux actions)
```

Layout flips via media query at ≥ 820 px: `SessionDrawer` becomes a permanent grid sidebar; `AppShell` becomes a two-column grid.

### 3.2 State

We use **Zustand** for global state, one store per domain:

- `useAuthStore`: token, password, auth status.
- `useSessionsStore`: session list snapshot, current session, current window, current pane, pane count.
- `useTerminalStore`: live buffer stream (bytes received but not yet drained to xterm), pane size, dirty flag.
- `useUIStore`: drawer/sheet/history/smart-keys open flags, theme, font size, toast queue.

Features import from their own store(s) only. Cross-store selectors live in `src/frontend/lib/state/` if needed.

### 3.3 Gestures

Every interactive drag uses `@use-gesture/react` with Pointer Events underneath. A shared `useDrag` hook normalizes:

- Axis decision (`x`, `y`, or `undecided` until 8 px movement).
- Threshold-based commit (with snap-back on release short of threshold).
- `setPointerCapture` to avoid losing events on fast drags.

Gesture ownership table (to prevent collisions):

| Target                      | Horizontal                      | Vertical                    | Long-press                                    |
| --------------------------- | ------------------------------- | --------------------------- | --------------------------------------------- |
| `TopBar` title-wrap         | switch window                   | —                           | open sessions drawer                          |
| `Surface` `.scroller`       | switch pane (dedicated handler) | **native scroll** (kinetic) | —                                             |
| `ScrollMirror`              | —                               | inherits native scroll      | native text selection                         |
| `FreezeLayer` (when active) | —                               | —                           | native text selection, fallback menu at 80 ms |
| `SessionCard`               | left-swipe → kill hint          | native scroll (list)        | open context menu (post-MVP)                  |
| `CommandSheet` grabber      | —                               | drag down → close           | —                                             |

**Pane switching** on `.scroller`: implemented via a horizontal-axis gesture that activates only when the initial movement is > 12 px and more horizontal than vertical. Once vertical scroll starts, horizontal is locked out for that gesture—we do not steal scroll.

### 3.4 Keyboard

All keyboard shortcuts and their effects live in `src/frontend/lib/keybindings.ts`. The `useKeyboardShortcuts` hook subscribes once at the `AppShell` level. Defaults:

| Chord                      | Action                                           |
| -------------------------- | ------------------------------------------------ |
| `Enter` (in compose)       | send                                             |
| `Shift+Enter` (in compose) | newline                                          |
| `Esc`                      | close topmost overlay (sheet → drawer → history) |
| `Ctrl/⌘+K`                 | toggle command sheet                             |
| `Ctrl/⌘+B`                 | toggle sessions drawer                           |
| `Ctrl/⌘+↑`                 | toggle history                                   |
| `Ctrl/⌘+/`                 | toggle smart-keys bar                            |
| `Alt+←` / `Alt+→`          | previous / next window                           |

Shortcuts are disabled while a text input/textarea outside the compose bar has focus.

## 4. Wire protocol

### 4.1 Inherited control messages

Port verbatim from tmux-mobile, plus a few additions. Source of truth: `src/shared/protocol.ts` (Zod schemas).

**Client → server**: `auth`, `select_session`, `new_session`, `new_window`, `select_window`, `kill_window`, `select_pane`, `split_pane`, `kill_pane`, `zoom_pane`, `capture_scrollback`, `send_compose`.

**Server → client**: `auth_ok`, `auth_error`, `tmux_state`, `session_picker`, `attached`, `scrollback`, `info`, `error`.

### 4.2 Additions for v1

- `rename_session` / `rename_window` (client → server)
- `sessions_snapshot` (server → client, pushed on request—contains last preview line per session for the picker)
- `capture_scrollback` gains an `includeEscapes: boolean` parameter (default `true`). Backend passes `-e` when true.
- `capture_scrollback` gains semantics for history seeding: called once at attach with `lines: 10000` (or configured `historyLimit`), response is piped into `term.write()` to populate xterm's scrollback (see ADR-0004).

Any other additions require an ADR.

### 4.3 Terminal socket

Unchanged: authed binary + JSON messages for resize, write, read. Same topology as tmux-mobile.

## 5. ANSI → DOM rendering pipeline (shared by History, Freeze, ScrollMirror)

A key new piece. Lives in `src/frontend/lib/ansi/` and is consumed by every DOM-mirror layer.

```
 ANSI-bearing string  (server sends capture_scrollback response)
         │
         ▼
 AnsiParser           (stateful; emits style-tagged text runs)
         │
         ▼
 HtmlRenderer         (maps runs → <span style="color:...">)
         │
         ▼
 HistoryLayer <pre>   (rendered with mono font stack matching xterm)
```

Requirements:

- Handles SGR 0/1/2/3/4/5/7/9 and 30–37/40–47/90–97/100–107 plus 38;5/48;5 (256-color) and 38;2/48;2 (truecolor).
- Strips or safely ignores unknown escapes (cursor moves, OSC); does not try to apply them—history is linear text by nature.
- Uses the same Nerd Font CSS stack as xterm so glyph widths align.
- Renders inside `white-space: pre` and `overflow: auto`—no word wrap, horizontal scroll for long lines.
- Preserves text for native selection: `user-select: text`, no hidden spans inside selectable runs.

We do **not** build our own terminal emulator. We only translate style runs. Cursor position, line clearing, alt-screen switches are ignored because the source (`capture-pane` or xterm's buffer) already gives us rendered lines.

### 5.1 Source-per-layer

| Layer          | Source                                                              | When it's built                                                         |
| -------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| ScrollMirror   | xterm buffer (visible window only, row-diff updated)                | Always active behind LiveLayer (ADR-0004)                               |
| FreezeLayer    | xterm in-memory buffer                                              | On long-press or freeze button (ADR-0003)                               |
| _History seed_ | `capture-pane -e -p -S -N` **on attach**, piped into `term.write()` | Once per attach; afterwards the history lives inside xterm's scrollback |

The ScrollMirror and FreezeLayer sources are zero-latency because xterm keeps the buffer in JS memory. History is **not a separate view**—it's whatever xterm's scrollback contains, reachable by scrolling up via native kinetic scroll. History seed at attach time makes past output immediately scrollable.

The standalone HistoryLayer concept from earlier drafts is obsolete; see ADR-0004 for the rationale.

## 6. Backend additions (small)

### New HTTP routes

- `GET /api/sessions/snapshot` — for each session, returns the top-of-screen preview line. Used by the sessions drawer. Implementation: parallel `capture-pane -p -t session:0 | tail -n 1`.
- `POST /api/sessions/:name/rename` — wraps `tmux rename-session`.

### Small additions to `TmuxGateway`

- `renameSession(old, new)`
- `sessionPreview(name)` returning `{ name, lastLine, paneCount, lastActivity }`

All new methods ship with `FakeTmuxGateway` implementations and unit tests.

## 7. Security

Retain tmux-mobile's model; see [`SECURITY.md`](../SECURITY.md) (copied from upstream, then re-examined).

- Token is 32-hex. Compared constant-time.
- Password is user-supplied or auto-generated 16-char. Compared constant-time.
- Bind `127.0.0.1` by default. Nginx in front for TLS.
- Env vars `TM_AGENT_TOKEN` / `TM_AGENT_PASSWORD` for systemd-persisted values.
- No secrets in logs. CLI accepts `--password` for one-shot dev use only.
- The clipboard copy path uses `navigator.clipboard.writeText` which requires a secure context; we never expose the app over plain HTTP in non-dev.

## 8. Deployment

Same topology as the current tmux-mobile install:

- Node backend as a `systemd` service, bound to `127.0.0.1:8767`.
- Nginx reverse proxy with TLS (Let's Encrypt via acme.sh), proxy_pass and WebSocket upgrade.
- Frontend is a static build served by the same Node backend under `/assets` + SPA fallback.

Production host template lives in `docs/deployment/nginx.conf.example` (added in Phase 0).

## 9. Build & test topology

```
package.json (single)
├── src/backend/   → tsc → dist/backend/
├── src/frontend/  → vite → dist/frontend/
└── src/shared/    → imported by both, Zod schemas
```

- `npm run dev` uses `concurrently` to run `tsx watch` on backend and `vite` on frontend. Vite proxies `/ws/*` and `/api/*` to the backend in dev.
- CI (GitHub Actions, Phase 0) runs: lint → typecheck → unit test → e2e (Playwright against `npm run build` output).

## 10. Known constraints and accepted tradeoffs

1. **Alt-screen apps (vim, htop, Claude Code TUI) have no tmux history.** The pull-down history view for those sessions will show only the current screen snapshot. We surface this state with a subtle label: "session is in alt-screen mode—history unavailable." Users who need full-session transcripts can rely on the terminal's own mechanisms (tmux `pipe-pane`, `script(1)`, etc.).
2. **Scrollback capture size.** Default history request is 2 000 lines. We do not paginate further in MVP. Users who want more can hit "Load more" to re-request with +1 000.
3. **Single active session per browser tab.** One browser tab attaches to one session at a time. Multiple tabs = multiple attachments (still sharing the same control socket for tmux state).
4. **No structured AI-agent parsing.** Per design principle 4, agent output is treated like any PTY output. An `aider` session and a `bash` session are structurally identical to this codebase.

## 11. Open questions (to be resolved by ADR)

- **Q1** — Font loading strategy. Do we ship a bundled Nerd Font WOFF2, or rely on the system's monospace? Open.
- **Q2** — Session auto-create on empty attach. If no session exists, do we create a default `main` (tmux-mobile default), or prompt the user? Probably keep tmux-mobile behavior; ADR if changing.
- **Q3** — Pane split interaction. When user taps "split pane" from the command sheet, does it add a new card and jump to it, or stay on the current and show a badge? Lean toward "jump to new card"; ADR before shipping.
- **Q4** — Desktop sidebar collapse. Should it be collapsible by the user, or always-on? Currently always-on; revisit if annoying.

## 12. Out of scope for v1 (in case someone tries)

- Multi-server (connecting to multiple remote hosts from one frontend).
- Embedded file editor.
- Built-in recording/replay.
- Shared session cursors across clients (tmux already handles this transparently; we just show it).
