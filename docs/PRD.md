# Product Requirements: TM-Agent

> Status: **draft v1**, 2026-04-19. Updates require a PR; keep a dated revision log at the bottom.

## 0. Positioning

TM-Agent is **the precision console for the agent era**: a UX-first tmux web client that lets developers observe, steer, and recover multiple long-running AI agents from anywhere.

The product is deliberately different from fully managed agent workspaces. It does not wrap your repo in another model-facing browser or ask a supervising agent to summarize what happened. It exposes the actual tmux sessions where Claude Code, Codex, Gemini CLI, Aider, Hermes, builds, tests, and logs are already running, so the user can inspect raw output, intervene precisely, and avoid unnecessary token spend.

## 1. Problem

A developer's inspiration doesn't wait for them to be at a desk. Modern agentic workflows (Claude Code, Codex, Gemini CLI, Aider, Hermes) and long-running development tasks routinely live inside tmux sessions on a remote machine. Today the practical options for checking on or driving those sessions from a phone are:

- **SSH into tmux via a mobile terminal app.** tmux's prefix-key vocabulary, copy mode, split-pane UI, and tiny status bar were all designed for desktop input. On a 400-px-wide touchscreen they are actively hostile.
- **Existing tmux-over-web clients** (tmux-mobile, wetty, gotty). These put a terminal emulator in the browser, which helps slightly but inherits every desktop-shaped interaction.
- **Fully managed agent workspaces.** They are convenient, but often add an extra model/browser layer between the user and the process. That can be imprecise, token-expensive, and weak at parallel supervision across several independent agents.

The result: users reach for their phone only when desperate, and reach for a laptop the moment they can. The phone's biggest advantage — being _always nearby_ — is wasted, and the user's best control surface for long-running agents remains locked to the desk.

## 2. Target users

Primary: **developers running long-running AI agents and terminal workloads on a remote server**, who sometimes need to glance, nudge, or react away from their desk. Typical workloads:

- Supervising AI coding agents (approving tool calls, inspecting diffs, kicking off next prompts).
- Running several agents in parallel across different repos, branches, or tasks.
- Sending screenshots, PDFs, logs, or generated files directly into an agent's prompt context.
- Monitoring builds, tests, deploys, or training runs.
- Responding to notifications ("your build is waiting on input").
- Capturing a thought as a quick prompt before it evaporates.

Secondary: same developers on a **tablet or desktop browser** where the codebase is not handy but a terminal session would help. We don't build a separate desktop app; the same responsive frontend covers both.

**Anti-persona**: "I want a full terminal replacement on my phone" or "I want a hosted agent to drive my whole browser for me." We are not that. TM-Agent is for precise supervision and intervention. For heavy terminal work, use a real terminal; for autonomous hosted coding, use the hosted tool.

## 3. Product principles

The five rules in [`DESIGN_PRINCIPLES.md`](./DESIGN_PRINCIPLES.md) are binding. Summarized:

1. Pane is a card, not a tile.
2. Live and history are separate physical surfaces, not overlapping modals.
3. Input is a docked compose bar above the virtual keyboard, never "tap the terminal to type".
4. Tmux state (sessions, windows) is top-level app navigation, not a prefix command.
5. xterm.js renders only the live view; DOM handles everything else.

A feature that violates any of these without a written exception in an ADR does not ship.

## 4. MVP user stories

Each story maps to one vertical slice; the slice ships when the story's acceptance tests pass.

### S1 — Resume last session

**As** a returning user on my phone  
**I want** the app to open onto my most recently used tmux session immediately  
**So that** I can see what's running without tapping through menus  
**Acceptance**: visiting the app URL with valid auth attaches to the previously attached session within 800 ms on a warm connection.

### S2 — Switch session

**As** a user with multiple tmux sessions  
**I want** to see all sessions with a one-line preview of recent output  
**So that** I can pick the right one at a glance  
**Acceptance**: sessions list shows name, attached status, last-active time, and last non-blank preview line. Tapping switches within 500 ms. Left-swipe reveals a kill action.

### S3 — Scroll the terminal naturally, including history

**As** a user who wants to read output above the visible frame—whether it was just printed or happened an hour ago  
**I want** to swipe the terminal up with native kinetic scroll physics  
**So that** the motion is indistinguishable from scrolling any other app or webpage  
**Acceptance**:

- Single-finger vertical drag on the terminal scrolls it with real browser momentum, including rubber-band at edges.
- Scroll reaches at least 10 000 lines of history on attach (history-seeded into xterm's scrollback via `capture-pane -e -p -S -N`).
- "Load more" button re-seeds with a larger limit while preserving scroll position.
- Live output auto-sticks to the bottom only when user was already within 2 rows of bottom at the moment new output arrived; otherwise the user's reading position is preserved.
- Long lines wrap at pane width (no horizontal scroll in live mode).
- Desktop mouse wheel and trackpad scroll the same way.
- During a scroll, long-press still enters freeze mode (ADR-0003); scroll and freeze are orthogonal.

### S3.1 — Freeze and select the live screen

**As** a user who sees something on the live screen _right now_ that I want to copy  
**I want** to long-press that spot and have the app instantly freeze the current pane, pre-select the word I pressed, and surface a copy action  
**So that** I don't have to chase moving text or remember what I wanted before scrolling through history  
**Acceptance**:

- Long-press ≥ 500 ms with < 10 px movement on the live surface enters **freeze mode** within one frame (uses cached xterm buffer, no network round-trip).
- A word-level selection is placed at the press coordinate on first entry.
- Native selection handles (iOS/Android) appear when the OS honors programmatic selection; otherwise a fallback floating menu with [Copy] / [Select line] / [Exit] is shown within 80 ms.
- Top bar shows an unmistakable "⏸ frozen — tap to return" state; tapping it or outside the selection exits.
- A dedicated freeze button in the top bar enters the same state manually (without a long-press).
- While frozen, incoming PTY output continues to be received in the background; exit returns the user to the **most recent** live frame with no dropped bytes.
- Works on canvas, webgl, and dom xterm renderers.

### S4 — Type and send

**As** a user composing a command or prompt  
**I want** to edit my input in a dedicated field before it's sent  
**So that** I don't fire off typos and I can use standard mobile text affordances (cursor, paste, autocorrect)  
**Acceptance**: compose bar stays docked above the virtual keyboard. Enter sends, Shift-Enter inserts newline. Smart-keys bar (Esc/Tab/arrows/pipes/etc.) is available via a top-bar toggle.

### S5 — Switch window

**As** a user with multiple windows inside the active session  
**I want** to swipe the top bar left/right or tap a window indicator  
**So that** I never need a prefix-key chord  
**Acceptance**: horizontal swipe on top bar changes window within the current session. Indicator dots reflect current window.

### S6 — Run a tmux command

**As** a user who needs to split a pane, rename, or kill  
**I want** a grid of common tmux actions one tap away  
**So that** I don't type `Ctrl-B` + letter on a virtual keyboard  
**Acceptance**: command sheet opens from a top-bar button or `Ctrl/⌘+K`, covers common actions (new window, split, rename, kill pane, kill session, copy screen, detach). Each action invokes the corresponding tmux call and closes the sheet.

### S7 — Desktop fallback

**As** a user on a laptop browser  
**I want** the same app to use full width efficiently  
**So that** I don't stare at a phone-shaped frame  
**Acceptance**: ≥ 820 px viewport width switches to two-column layout—sessions sidebar permanent on the left, main area fills the rest. No feature hidden from mobile is added on desktop, and vice versa. On first load the sidebar already lists every tmux session; the attached one is marked.

### S8 — Connection health

**As** a user whose phone just dropped the LTE signal, or who came back after the backend restarted  
**I want** the app to tell me the connection state and offer a one-tap reconnect  
**So that** I don't guess why typing does nothing and I don't have to reload the page (which loses terminal scroll position)  
**Acceptance**:

- TopBar shows a status dot at all times: green (open), amber (connecting), red (closed).
- When the control WebSocket closes for any reason except the user closing the tab, the dot turns red and a **Reconnect** button appears in the TopBar within one second.
- Tapping Reconnect re-opens the control socket (and the downstream terminal socket) without a page reload.
- A dropped socket does **not** bounce the user to the "auth failed" screen — auth and transport are separate concerns.

## 5. Non-goals for MVP

- **Cross-session search** or persistent log archive. Tmux's scrollback is enough.
- **Multi-device sync** of open session state or compose drafts.
- **Agent-specific UI** (bubble rendering, diff viewers, tool-call collapsibles). See principle 4 explicitly rejects this.
- **Voice input.** Nice later; not MVP.
- **Push notifications** for idle session events.
- **Structured agent transcript parsing.** Agent output is terminal output. We add smart edges around the PTY, not a second UI model for each agent.
- **Themeable UI.** One dark theme; polish it.
- **Collaborative editing** / shared cursor across clients.

Each of these may become post-v1 roadmap items, but shipping them early costs more than the value before MVP ships.

## 6. Success metrics

We are pre-v1. No analytics plumbing in MVP. Success is subjective and measured by:

- The primary author (and the 3–5 friends who get early access) actually reach for this app on their phone when they used to reach for their laptop. If they don't, we iterate.
- No open bug with severity ≥ "terminal output is wrong" or "wrong session attached".
- Time-to-first-command from cold-start app open: p50 ≤ 3 seconds, p95 ≤ 6 seconds on 4G.
- Parallel supervision: a desktop user can keep two to four agents visible and confidently send the next prompt to the intended session.
- Token discipline: common "what happened?" checks should be answered by reading the raw tmux output, not by asking another model to re-summarize a browser state.

Once usage stabilizes, a lightweight opt-in telemetry ADR will define actual metrics.

## 7. Out of scope (explicitly)

- Writing our own terminal emulator. We use xterm.js.
- Running tmux itself in the browser. We talk to the server's tmux.
- Supporting tmux < 3.2. We use modern format strings.
- Supporting non-POSIX platforms for the server. It's Linux and macOS; Windows via WSL works but isn't tested.

## 8. Competitive / prior art

- **tmux-mobile** (origin fork). Solved the transport layer. Fails the touch-UX bar we now require. We inherit its backend, replace its frontend.
- **porterminal**. UI polish but desktop-shaped. We took the "what if it were nice" ambition; the interaction model is our own.
- **WebSSH / Termius / Blink Shell**. Mobile-native but SSH-only; no tmux-aware navigation.
- **OpenClaw / Hermes-style hosted agent workspaces.** Higher-level managed agent surfaces. Useful when you want the platform to own the workflow; less appropriate when the user already has several CLI agents running in tmux and wants raw, precise, low-overhead control.
- **code-server / GitHub Codespaces**. Full IDEs—overkill and slow for the glance/nudge workflow.
- **Cockpit / Webmin**. Open-source precedents for terminal + file transfer + live system metrics, but they are host-management products. TM-Agent borrows the compact signal style, not the admin-console scope.
- **Apache Guacamole / JumpServer / Next Terminal**. Bastion/audit tooling with mature file transfer. Reference for safe transfer patterns, not for audit/recording/compliance features.

## 9. Revisions

| Date       | Change                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-19 | Initial draft (v1).                                                                                                                                                   |
| 2026-04-20 | S7 clarifies first-load sidebar population; add S8 (connection health + reconnect).                                                                                   |
| 2026-04-21 | Expand non-goals §5 (file upload/download, system status panel) with prior-art references; add Cockpit / Guacamole / JumpServer to §8. Details in research note 0008. |
| 2026-04-27 | Reframe public positioning around multi-agent precision control, token discipline, and direct tmux supervision.                                                       |
