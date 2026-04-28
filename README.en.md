# TM-Agent

**English** · [简体中文](./README.md)

> **The precision console for the agent era** — steer multiple AI agents from anywhere, save tokens, and stay in control.

TM-Agent is a UX-first tmux web client optimized for Claude Code, Codex, Gemini CLI, Aider, Hermes, and other agentic terminal workflows. Compared with fully managed agent workspaces such as OpenClaw or Hermes-style hosted environments, TM-Agent does not hand your browser, repo, and context to yet another supervising agent. It puts you directly inside your remote tmux sessions, so you can inspect raw agent output, intervene only when needed, and orchestrate several long-running agents with less summarization, less context churn, and fewer wasted tokens.

It is not another SSH-in-the-browser, and it is not a desktop UI with a mobile skin glued on. Every interaction is designed from the phone outward, then reflows into a serious desktop command deck.

Backend forked from [DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile); frontend rewritten from scratch.

> Status: **Public preview / v0.1.0** · touch-first terminal · desktop multi-session tiling · Files panel · Direct Mode · i18n. Planning log in [`docs/ROADMAP.md`](./docs/ROADMAP.md).

---

## ✨ Highlights

- 📱 **Phone-friendly** — touch scrolling, long-press copy, portrait-first layout
- 📎 **Attach straight to the agent** — paste or drop images, PDFs, code, or any file into the input; TM-Agent uploads it and injects the path into the prompt. **No more `scp`.**
- 🪟🪟 **Multi-session command deck** — desktop 1×1 / 1×2 / 2×2; observe and direct up to four agents in parallel
- 📜 **Native tmux scrollback** — mouse wheel / drag selection / Cmd-C copy work like browser primitives, not a fake terminal mode
- 🗂️ **Built-in file manager** — inspect results immediately: browse / preview / upload / download / delete
- ⚡ **Agent-optimized sessions** — create Claude Code / Codex / Gemini / Hermes sessions directly, with smart slash completion
- 🚀 **Direct Mode** — traditional webshell power when you need it; keyboard events pass through to the PTY, so vim and Ctrl-C work natively
- 📈 **System pulse** — live CPU / memory / load sparklines while your agents run
- 🔐 **Production-ready** — one-line `curl` install; systemd + nginx + TLS templates included

---

## 🎯 Things we got right

- 🖱️ Native scroll over tmux scrollback
- 📋 Drag-select copies plain text
- 👆 Long-press to freeze + pick
- 🌊 Browser-kinetic scroll on mobile
- ⌨️ Soft keyboard never crushes the term
- 🀄 IME input never drops a character
- 🔌 Close the tab, agent keeps running
- 🖼️ Paste / drop a file — no `scp` needed
- ⚡ Type `/` for smart completion
- 🪟 Desktop 2×2 multi-agent tile
- 🚀 Direct Mode: keys → PTY raw
- 🗂️ Built-in Files browser & preview
- 📈 CPU / memory sparkline footer
- 🔣 QR codes & half-block glyphs line up perfectly

---

## Feature deep-dive

### 📎 Paste / drop, agent reads — no more `scp`

Want the agent to look at a screenshot in a regular webshell? You `scp` it up and copy the path. **TM-Agent removes that whole step:**

- **Screenshot → Cmd-V** drops the image straight into the Compose Bar
- **Any file** — image / PDF / video / code — can be pasted, dragged, or attached
- The backend writes to `msg-upload/<timestamp>-<filename>` and auto-appends `File path for this message: msg-upload/...` to the message
- Claude Code / Codex / Aider `Read` the relative path immediately

Screenshot → bug report → agent debugs the picture, end to end, never leaving the browser.

### ⚡ Smart slash completion — stop memorizing commands

Type `/` in the Compose Bar. The frontend detects whether the current pane is shell-idle or a TUI, and which TUI it is — Claude Code / Codex / Gemini CLI / Hermes / Aider — then pops the matching slash menu (`/help`, `/clear`, `/resume`, `/compact`, ...). New agents become productive in seconds; you never have to memorize per-tool incantations.

### 🪟🪟 Multi-session tiling on the desktop

The TopBar's ⊞ layout button cycles 1×1 / 1×2 / 2×2. Each cell holds an independent tmux session — one Claude Code, one Codex, one `tail -F` on the logs, one aider — **four agents in parallel, no collisions**. Each slot has a position color (cyan / amber / violet / rose); the focused slot gets a thicker border, and the Compose Bar shows `→ session-name` so it's always obvious _which agent the next message is going to_. `Ctrl+1..4` cycles focus. Closing a slot auto-packs and steps the layout down (4→3→2→1). Direct Mode's breathing glow follows focus. Backed by per-(client, slot) PTYs in the backend; tmux itself is unchanged. See [ADR-0013](./docs/adr/0013-multi-pane-desktop-tiling.zh.md).

### 🚀 Direct Mode — desktop keys, 100% to the PTY

On desktop (≥820px + fine pointer) TM-Agent exposes a Direct Mode switch. With it on, **every keyboard event** (Ctrl / Alt / Shift / combos) flows straight to the PTY, bypassing the Compose pipeline — vim, the tmux prefix, Ctrl-C all behave natively. The Compose Bar dims, the terminal gets a soft breathing glow, and a top-bar pulse confirms the mode. Exit with `Ctrl+]`, `Shift+Esc`, the indicator button, or the same toggle.

> Direct Mode is **deliberately not on mobile** — soft keyboards have no physical modifiers, so the feature would be crippled by design. This is a conscious tradeoff, not a missing feature.

### 📱 What we got right on mobile

- **Native kinetic scroll.** `.scroller` is a real scroll container; `.spacer` matches the tmux buffer length; `.viewport` sticks to the top. A single `scroll` listener drives `term.scrollToLine(n)` — the browser does the kinetic math. See [ADR-0004](./docs/adr/0004-native-scroll-via-virtual-container.md).
- **Long-press freeze + select.** A `color: transparent` DOM mirror sits above the canvas to carry the real text. Long-press 500ms with <10px drift snapshots the current frame into a `FreezeLayer` (Copy / Select line / Exit) — live PTY output can never steal your selection again. See [ADR-0003](./docs/adr/0003-freeze-and-select.md).
- **History is just scrolling up.** On attach, the backend pushes 10 000 lines of `capture-pane -e` before opening the live socket. Scrolling up through history and scrolling up through recent output use the **same gesture** — there is no separate "history view" mode.
- **Soft keyboard doesn't crush the terminal.** `VisualViewport` API + CSS pin the Compose Bar to the keyboard's top edge. Not `position: fixed` — that one fights the iOS soft keyboard.

### 🗂️ Built-in file manager

The Files panel in the sidebar is a complete file browser: breadcrumbs, click-to-open, upload / download / delete / rename, native preview for images / PDF / video / audio / Markdown / code (video & audio honor range requests so you can scrub). The backend defends against symlink escapes and path traversal. Whatever the agent produces, you can grab it without leaving the page.

### 📈 Live system pulse

Pinned to the sidebar foot: CPU% / memory% / load1 dual sparklines, refreshed every 2s, with 60s history on hover. When the sidebar is collapsed they degrade to three threshold dots (green / amber / red). When several agents share the box, you see at a glance who's eating the machine. Linux only.

### ⌨️ Compose-to-tmux — IME-friendly send pipeline

Text input is composed entirely in the browser IME (Chinese, pinyin, emoji — all fine). On submit we use `set-buffer` + `paste-buffer -dpr` to inject the whole prompt at once, instead of a per-character keystream — the agent never reads a half-typed prompt mid-flight.

### 🪟 Two-column reflow on the desktop

Same code, two shapes: phone is a drawer plus a single full-screen pane; desktop is a persistent sidebar (Sessions / Files / Sysinfo) plus the terminal. Not two codebases, not a responsive skin — one component tree that genuinely reflows at the breakpoint.

---

## Quick Start

```bash
git clone https://github.com/ChuangLee/TM-Agent.git
cd TM-Agent
npm install
npm run dev
```

`npm run dev` runs the backend (`tsx watch`) and Vite concurrently. Vite proxies `/ws/*` and `/api/*` to the backend. By default the backend mints a fresh token at startup; grab it from the log and open `http://localhost:5173/?token=<token>`.

```bash
npm test            # vitest unit + integration
npm run test:e2e    # playwright (builds first)
npm run typecheck   # tsc --noEmit (backend + frontend)
npm run lint        # eslint
npm run build       # frontend via vite, backend via tsc
```

---

## Deployment

**One-line install (recommended):**

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh | sudo bash
```

With options:

```bash
curl -fsSL https://raw.githubusercontent.com/ChuangLee/TM-Agent/main/scripts/bootstrap.sh \
  | sudo bash -s -- --workspace-root /root/repos
```

`bootstrap.sh` installs `git` if needed, clones the repo to `/opt/tm-agent`, and hands off to `scripts/install.sh` (idempotent — re-run = upgrade). `install.sh` bootstraps tmux, openssl, native build tools, and Node.js 20+ on common Linux distros, then does the rest: `npm install` → `npm run build` → `npm prune --omit=dev` → mint random token / password → write `/etc/tm-agent/env` (mode 600) → install the systemd unit → `systemctl enable --now`. `--workspace-root` constrains the session-wizard directory picker to that path (ADR-0017).

The one thing the script does not do is nginx / Caddy + TLS — every reverse proxy setup is too different to canonicalize. The backend listens on `http://127.0.0.1:8767/?token=<token>` by default. Templates:

- Standalone subdomain (`https://tmux.host.example/`): [`docs/deployment/nginx.conf.example`](./docs/deployment/nginx.conf.example)
- Caddy standalone subdomain: [`docs/deployment/Caddyfile.example`](./docs/deployment/Caddyfile.example)
- Subpath (`https://host.example/tmux/`): [`docs/deployment/nginx.conf.example.subpath`](./docs/deployment/nginx.conf.example.subpath) — pass `X-Forwarded-Prefix: /tmux`; no `--base-path` reinstall needed
- Caddy subpath: [`docs/deployment/Caddyfile.example.subpath`](./docs/deployment/Caddyfile.example.subpath)

**Already cloned the repo?** Just run `sudo ./scripts/install.sh --workspace-root ~/repos`. Full manual steps in [`docs/deployment/README.md`](./docs/deployment/README.md).

---

## Architecture

- [`docs/PRD.md`](./docs/PRD.md) — user stories & success criteria
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — module boundaries, wire protocol, state shape
- [`docs/DESIGN_PRINCIPLES.md`](./docs/DESIGN_PRINCIPLES.md) — the five rules that govern every UX decision
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — historical planning log and upcoming direction
- [`docs/adr/`](./docs/adr/) — architectural decision records; non-trivial structural choices land here first

```
src/
├── backend/           # Node + Express + ws + node-pty + tmux gateway
├── frontend/          # Vite + React 19 + Tailwind + xterm.js
│   ├── app/           # AppShell
│   ├── features/
│   │   ├── action-panel/
│   │   ├── auth/      # password prompt
│   │   ├── compose/   # ComposeBar
│   │   ├── direct-mode/
│   │   ├── files/     # sidebar file browser + preview
│   │   ├── key-overlay/
│   │   ├── sessions/
│   │   ├── shell/     # TopBar + shell chrome
│   │   ├── sysinfo/
│   │   └── terminal/  # MultiSurface, SlotFrame, xterm wiring
│   ├── hooks/         # control-session, terminal/session lifecycle
│   ├── lib/ansi/      # xterm buffer cells → HTML
│   ├── services/      # control-ws / terminal-ws clients, config api
│   ├── stores/        # zustand (auth, sessions, layout, terminal, files, sysinfo, ui)
│   └── styles/        # tokens.css = single source of truth for cell metrics
└── shared/            # wire protocol types
```

---

## Status

| Area                         | State                          |
| ---------------------------- | ------------------------------ |
| Live terminal / auth / send  | shipped                        |
| Mobile scroll / freeze / IME | shipped                        |
| Sessions / Files / Sysinfo   | shipped                        |
| Multi-session tiling         | shipped                        |
| Direct Mode                  | shipped                        |
| i18n / install / deploy docs | shipped                        |
| Post-v0.1 focus              | polish, packaging, performance |

---

## Contributing

Workflow, commit convention, PR checklist — all in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Acknowledgements

This project stands on the shoulders of giants — none of it exists without them.

- **[DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile)** — direct upstream of the backend fork. Node + `ws` + `node-pty` + tmux CLI gateway, the password / token two-factor auth, the `FakeTmuxGateway` / `FakePtyFactory` test doubles — all inherited and continuously extended. TM-Agent rewrote the frontend wholesale and added backend capabilities for multi-slot routing, files, sysinfo, and install/deploy workflows. Thanks to the DagsHub team for building and open-sourcing this foundation.
- **[tmux](https://github.com/tmux/tmux)** — the de facto backend. The session / window / pane model has been correct for decades, to the point that "running an agent as a long-lived process" needed no new concepts from us.
- **[xterm.js](https://github.com/xtermjs/xterm.js)** — used as a headless ANSI parser + buffer engine (ADR-0005); the rendering layer is ours. Without xterm's mature VT parser, the live pane wouldn't be possible.
- **[shadcn/ui](https://ui.shadcn.com/)** + **[Radix UI](https://www.radix-ui.com/)** — source of the a11y primitives (sidebar, dialog, popover, ...).
- **React 19 · Vite 7 · Tailwind v4 · motion · @use-gesture/react · @tanstack/react-virtual** — the rest of the modern web stack; per-choice rationale lives in `docs/adr/`.

## License

MIT. Backend forked from [DagsHub/tmux-mobile](https://github.com/DagsHub/tmux-mobile) (also MIT); upstream copyright notices preserved in the relevant files. The frontend is original code.
