# Roadmap

Phased, incremental delivery. Each phase is meant to be independently shippable—at the end of any phase, the app is usable, even if limited.

## Phase 0 — Bootstrap (target: 1–2 days)

**Goal**: fork tmux-mobile backend into this repo, strip the frontend, establish tooling.

- [x] Port `src/backend/*` from tmux-mobile. Rename env vars to `TM_AGENT_*`. Drop cloudflared module.
- [x] Port backend tests (`FakeTmuxGateway`, `FakePtyFactory`, integration suites).
- [x] Set up Tailwind v4, shadcn/ui, motion, `@use-gesture/react`, `@tanstack/react-virtual` in `src/frontend`.
- [x] Configure ESLint (typescript-eslint + react-hooks + react-refresh), Prettier, tsconfig strict for both sub-projects.
- [x] Add pre-commit hook (`lefthook`) running typecheck + lint + unit tests.
- [x] GitHub Actions CI: lint → typecheck → test → build on every PR and on `main`.
- [x] Minimal `AppShell` renders a "hello TM-Agent" placeholder; `/api/config` responds; `/ws/control` accepts auth.
- [x] Production deploy script / nginx example.

**Definition of done**: a fresh clone can `npm install && npm run dev` and see a placeholder UI talking to a live tmux backend.

## Phase 1 — Live terminal + compose (target: 3–5 days)

**Goal**: usable single-session terminal on mobile and desktop.

User stories: S1 (resume last), S4 (type and send), S7 (desktop fallback).

- [ ] `LiveLayer` embeds xterm.js (scrollback: 0), receives PTY bytes from `TerminalWebSocket`.
- [ ] `ComposeBar` with `textarea`, send, Enter-to-send, Shift-Enter for newline.
- [ ] `VisualViewport` handling: compose bar docks above virtual keyboard on iOS Safari and Android Chrome.
- [ ] `TopBar` with session name (read-only for now), no window strip yet.
- [ ] Responsive: ≥ 820 px swap to two-column grid with placeholder sidebar.
- [ ] Playwright e2e: auth → attach → send command → see output.

**Definition of done**: user opens URL on phone, sees the previously attached session, types `ls`, sees output.

## Phase 2 — Native scroll, DOM mirror, freeze-and-select (target: 5–7 days)

**Goal**: the terminal scrolls, selects, and freezes like it should. One shared DOM-mirror + ANSI→HTML pipeline powers scroll-time selection and freeze-time selection.

User stories: S3, S3.1. ADRs: 0003 (freeze), 0004 (native scroll).

### Shared pipeline

- [x] `capture_scrollback` extended with `includeEscapes: true` by default (backend passes `-e`).
- [x] ANSI parser + HTML renderer in `src/frontend/lib/ansi/`. Handles SGR + 256 + truecolor. Wide chars tagged via `xterm.buffer` API, rendered with fixed width class.
- [x] Shared mono/Nerd Font CSS stack in `styles/tokens.css` used by LiveLayer xterm and every DOM layer. Line-height in px to match canvas exactly.

### Virtual scroll container + ScrollMirror (S3, ADR-0004)

- [x] `.scroller` + `.spacer` + `.viewport` layout as described in ADR-0004.
- [x] rAF-throttled scroll event → `term.scrollToLine(n)` + mirror re-render.
- [x] Row-diff DOM mirror updates; style classes generated once into a stylesheet.
- [x] Stick-to-bottom heuristic (within 2-row tolerance) vs preserve-position.
- [x] Alt-screen detection via `term.buffer.onBufferChange` → collapse spacer + banner.
- [x] Pane switch pattern: horizontal-first gesture on `.scroller`, locked out once vertical scroll starts. (Detector lands in Phase 2; Phase 5 wires it to PaneCarousel.)
- [x] History seed at attach: backend captures with `-e` and pushes `scrollback` immediately after `attached`; client writes to `term` before the live socket opens.
- [ ] "Load more" re-seeds with larger limit, restores scroll anchor. (Deferred: v1 eager-seeds 10k lines, which covers the observed working range.)
- [ ] Test matrix: iOS Safari 16/17/18, Android Chrome low-end, desktop Chrome/Firefox/Safari. All three xterm renderers (canvas, webgl, dom) must align. (Manual QA after first live-device session.)

### FreezeLayer (S3.1, ADR-0003)

- [x] `FreezeLayer` reads from xterm's in-memory buffer on demand (zero network).
- [x] Long-press detector (500 ms, <10 px drift) on Surface triggers freeze + pre-select word at touch point via `caretPositionFromPoint` + `Selection.setBaseAndExtent`.
- [x] Top-bar **Freeze button** enters the same state manually.
- [x] Floating menu always visible while frozen: Copy / Select line / Exit.
- [x] Incoming PTY bytes keep flowing into xterm while frozen; exit lands on the latest live frame, no dropped output.
- [ ] Verified on canvas, webgl, dom xterm renderers. (Manual cross-renderer QA pending.)

**Definition of done**: user on a phone (a) swipes the live terminal upward and it scrolls with native kinetic physics through 10 000 lines of scrollback, (b) long-presses any visible character to freeze and copy, (c) new output tails automatically iff they were already at bottom. Each motion feels like iOS/Android, not a JS reimplementation. Mouse wheel and trackpad work the same on desktop.

## Phase 3a — Sessions list + connection health (target: 1–2 days)

**Goal**: remove the two biggest "lost without the UI" complaints — the desktop sidebar is empty even when multiple sessions exist, and a dropped WebSocket silently looks like the app froze.

User stories: S2 (list part), S7 (first-load sidebar), S8 (connection health).

- [ ] `connection-store` (Zustand) exposes control-WS status (`idle` / `connecting` / `open` / `closed`) to the UI. A closed socket no longer flips `auth.phase` to `"failed"`.
- [ ] `use-control-session` publishes ControlWsClient status into the store; provides an imperative `reconnect()`.
- [ ] `TopBar` renders a status dot + the current session name; when status is `closed`, replaces the dot with a **Reconnect** button.
- [ ] `SessionList` component renders every session from `useSessionsStore.snapshot`, marks the attached one, dispatches `select_session` on tap.
- [ ] Desktop: `SessionList` fills the `md:[grid-area:sidebar]` slot (replaces the "Phase 3 lands later" placeholder).
- [ ] Mobile: tapping the TopBar session name opens a bottom-sheet drawer with the same `SessionList`; tapping a row closes it.

**Definition of done**: on both PC and mobile the user sees every tmux session from frame one, can switch by tapping, and when the WS drops the TopBar surfaces a Reconnect button that restores the live stream without a page reload.

## Phase 2.5 — Mobile UX pivot (target: 2–3 weeks; ADR-0006)

**Goal**: replace the compose-bar-primary mobile input model with a shell-state-aware action panel + top-drop key overlay. Desktop unchanged.

~~Gated behind an `action_first` debug flag.~~ Flag removed 2026-04-21 (see ADR-0006 addendum). ActionPanel + KeyOverlay now render unconditionally; the top-edge-pull gesture auto-gates on `matchMedia("(pointer: coarse)")` so only touch devices get it. Phase 1 compose-bar UI is no longer a fallback — the action-first model is the only UI.

Sequenced PRs (each self-contained, shippable, flag-gated):

- [x] **PR1 — Classifier + backend signal.** Backend: push `#{pane_current_command}` per-pane in the tmux snapshot; Zod schema addition in `src/shared/protocol.ts`. Frontend: `classify()` pure function + `useShellState()` hook. Table-driven unit tests. (commit `5c3b94f`)
- [x] **PR2 — ActionPanel shell.** Horizontal card-strip component. `shell_idle` + `editor` card sets wired. Visible only with the flag on. (commit `64e8227`)
- [x] **PR3 — Remaining 6 states.** `tui`, `repl`, `pager`, `confirm_prompt`, `password_prompt`, `long_process` card sets + prompt-capture banner component. (commit `e87d9a0`)
- [x] **PR4 — KeyOverlay.** Top-drop semi-transparent layer; reverse-priority internal layout; sticky modifier keys. (commit `a76dab0`; top-edge pull-down gesture replaced by an explicit TopBar ⌨ button on 2026-04-21 — see ADR-0006 addendum.)
- [x] **PR5 — ComposeBar extensions.** Per-session in-memory command history, draft stash, quick-insert tray (v1.1 deferrable). (commit `f62f393`)
- [x] **PR6 — Desktop Direct Mode.** One-click toggle from desktop TopBar. Direct `keydown` → PTY byte mapping with IME fallback textarea. Visual: non-Surface UI blurred + breathing glow + pulsing top-banner indicator. `Ctrl+]` and double-Esc as additional exit paths. (commits `03e4818`, `ae7105d`)

**Definition of done**: on a phone, the user opens a session, sees state-appropriate cards, can run `npm run dev` → tail output → Ctrl+C → respond to a `[Y/n]` prompt → type a commit message, all via cards + overlay + compose, without ever summoning the system virtual keyboard for a single-key or repetitive action. Unit + integration + Playwright 8-state suite green.

Execution gates per ADR-0006 §Execution flow.

## Phase 3b — Window navigation and rename (target: 2 days)

**Goal**: finish the navigation story inside a session.

User stories: S2 (preview + kill), S5.

- [ ] `GET /api/sessions/snapshot` backend route (if still needed — the control-WS tmux_state snapshot may be sufficient).
- [ ] Session cards gain last-active time + a one-line preview of recent output.
- [ ] Left-swipe on session card reveals kill action (second tap to confirm).
- [ ] `TopBar` window strip with indicator dots; swipe horizontally to switch window.
- [ ] `rename-session` / `rename-window` via bottom sheet action.

**Definition of done**: user switches between 3 named sessions via drawer; switches between 2 windows via top-bar swipe; renames one.

## Phase 4 — Commands and smart keys (target: 2 days)

**Goal**: cover the rest of day-to-day tmux actions without prefix-key.

User story: S6.

- [ ] `CommandSheet` with 12-tile grid: new window, split h/v, zoom, rename, kill pane, refresh, copy screen, next/prev window, detach, kill session.
- [ ] `SmartKeysBar` with Esc/Tab/Ctrl(sticky)/arrows/pipes. Emits PTY escape sequences.
- [ ] Keyboard shortcuts (`Ctrl/⌘+K`, etc.) wired via `useKeyboardShortcuts`.
- [ ] All destructive actions (kill pane, kill session) require a confirm toast-tap.

**Definition of done**: user splits, zooms, renames, kills from the command sheet with no terminal typing.

## Phase 5 — Panes as cards (target: 2 days)

**Goal**: mobile-native multi-pane navigation.

- [ ] `PaneCarousel` in `Surface`: horizontal swipe between panes of the current window.
- [ ] Dot strip at the bottom indicates pane count and active pane.
- [ ] Splitting a pane animates the new card in; focus jumps to it.
- [ ] Desktop: same carousel by default; opt-in side-by-side is post-v1.

**Definition of done**: user in a two-pane window can swipe between panes; splitting adds a card without layout jolt.

## Phase 6 — Polish (target: 2–3 days)

**Goal**: remove the "prototype" feel.

- [ ] Motion transitions for drawer open, sheet open, history pull.
- [ ] Toasts for every mutation (`kill-session main`, `rename-window built-watch`).
- [ ] Pull-to-refresh on session list.
- [ ] Empty states with helpful copy.
- [ ] Dark theme refinement, color tokens finalized.
- [ ] Loading skeletons for session cards.
- [ ] A11y pass: landmarks, focus rings, `aria-*` on interactive targets.
- [ ] Lighthouse PWA audit ≥ 90 on all categories.

**Definition of done**: the author's friends say "this is nice" unprompted.

## Post-v1 (not committed, ordered by likelihood)

1. Opt-in side-by-side panes on tablet/desktop (pinch-to-zoom-out or a dedicated toggle).
2. Session pinning / starring / ordering.
3. Cross-session search backed by a lightweight SQLite log sink.
4. Voice input for compose.
5. Push notifications for "session is waiting on input" heuristics.
6. Theme picker + font size picker persisted in localStorage.
7. Multiple remote hosts (one frontend, multiple TM-Agent backends).
8. ~~Desktop Direct Mode~~ — **promoted into Phase 2.5 PR6** (2026-04-20) per ADR-0006 §5.
9. ~~Feature survey: borrow from tmux-mobile upstream + ttyd / wetty / gotty / xterm.js demos.~~ — **completed** as [docs/research/0006-mobile-action-first-research.md](research/0006-mobile-action-first-research.md); borrow list folded into Phase 2.5 implementation.
10. ~~Browser ↔ server file transfer.~~ — **promoted to current phase** (2026-04-22) as part of the broader [Sidebar File Panel](#sidebar-file-panel-adr-0012-2026-04-22). Scope widened from pure transfer to browse + preview + upload + download per [ADR-0012](adr/0012-sidebar-file-panel.zh.md). Guacamole's `guacctl` shell-triggered pattern is dropped in favor of a ComposeBar-attachment primary upload path (the real user intent turned out to be "send screenshots to the AI agent", not generic file management).
11. ~~System status sparkline strip.~~ — **promoted to current phase** (2026-04-22) per [ADR-0011](adr/0011-sidebar-system-status.zh.md). See "System status panel" below.

## Sidebar File Panel (ADR-0012, 2026-04-22)

Promoted from Post-v1 #10. Scope locked by [ADR-0012](adr/0012-sidebar-file-panel.zh.md). **Next up after Phase 2.5 — before Phase 3b.** Two independent tracks; Track A ships user value without Track B.

### Track A — ComposeBar attachment (primary upload path)

The real v1 use case for "upload" is "paste a screenshot into the compose bar and have the AI agent read it." Files auto-upload to `./msg-upload/` under the pane cwd; the message text gets a trailing `本消息对应的文件路径为: msg-upload/<ts>-<name>` so agents receive a working relative path.

- [x] PR1 — Protocol: `TmuxPaneState.currentPath` + tmux format field. Backend `path-guard.ts` with `realpath`-based containment check. Unit tests cover `..`, symlink escape, case sensitivity, trailing slash.
- [x] PR2 — `POST /api/files/upload?paneId=X&rel=<dir>` via `busboy`. Mkdir-p on first write. `TM_AGENT_FILES_MAX_UPLOAD_MB` (default 100). Integration tests for golden path + all security reject branches.
- [x] PR3 — ComposeBar attachment UI: paste / drop / 📎 button. Per-session staging. XHR progress. Send-time message rewrite. **Bonus: compose slot now holds a fixed 72px grid row with the ComposeBar abs-positioned `bottom:0` — Shift+Enter / attachment chips expand _upward_ over the Surface instead of forcing xterm reflow.** (Playwright e2e for the rewrite path deferred; unit tests cover the compose pipeline end-to-end.)

### Track B — FilePanel browse / preview / explicit transfer

- [x] PR4 — Sidebar tab switch (`Sessions` / `Files`) persisted via `useUiStore.sidebarTab`. `FilePanel` with breadcrumb + virtual list + auto-rehome on `pane_current_path` change. `GET /api/files/list` + `/meta`.
- [x] PR5 — `FileViewer` overlay over Surface. Zero-dep viewers for image / PDF (native iframe) / video / audio / sandboxed HTML / plain text / JSON. `GET /api/files/raw` with Range support.
- [x] PR6 — Markdown viewer (`react-markdown` + `remark-gfm`, lazy) + code viewer (`shiki`, lazy, 30-language whitelist). Theme follows `useUiStore.theme`.
- [x] PR7 — `GET /api/files/download` (attachment disposition) + FilePanel drop-zone upload + XHR progress + conflict dialog (overwrite-all / skip-all).

**Explicit non-goals**: rename / delete / mkdir (users have the shell), office document preview (too heavy for the value), git status markers, cross-pane browsing, remote SSH passthrough, `msg-upload/` auto-cleanup.

**Definition of done**: a user in a Claude Code session can (a) paste a screenshot into compose, see it upload, send the message, and Claude reads the file from `msg-upload/...`; (b) in the sidebar, open the Files tab and preview a markdown report the agent just generated; (c) drag a local log file onto the FilePanel to upload it to the current browsed directory; (d) download any generated file via its viewer's toolbar. Path traversal and symlink escape are rejected with 403 in all endpoints.

## System status panel (ADR-0011, 2026-04-22)

Promoted from Post-v1 #11. Scope locked by [ADR-0011](adr/0011-sidebar-system-status.zh.md):

- [ ] Backend `src/backend/sysinfo/` reads `/proc/{stat,meminfo,loadavg,uptime}` every 2 s, emits `system_stats` on control WS.
- [ ] `system_stats` variant added to `src/shared/protocol.ts`.
- [ ] Frontend `sysinfo-store` keeps a 30-sample (60 s) ring buffer.
- [ ] `SysinfoPanel` renders under `SessionList` (expanded) with 2 sparklines + load1 + uptime tooltip.
- [ ] `SessionRail` collapsed-mode footer shows 3 threshold-colored dots.
- [ ] Non-Linux platforms: backend marks `unsupported`; panel hidden.

**Definition of done**: at a glance from the sidebar a user sees current CPU %, Mem %, and load1 plus a 60 s trend, without leaving their session.

## Phase: Desktop multi-pane tiling (ADR-0013, 2026-04-22)

**Goal**: on desktop, run up to 4 tmux sessions side-by-side so the user can orchestrate multiple agents in parallel without context-switching.

- [x] PR #1 — `useLayoutStore` (mode / slots / focusedSlot) + TopBar ⊞ Layout button (Single only). 16 unit tests.
- [x] PR #2 — `terminal-store` keyed by SlotId; protocol gains optional `slot?: WireSlotId` on select_session / terminal_ready / send_compose / send_raw / attached / scrollback. 7 unit tests.
- [x] PR #3 — backend per-slot TerminalRuntime, `MultiSurface` + `SlotFrame` with mini-bar / ✕ / EmptySlotPicker, `ComposeFocusIndicator`, `detach_slot` protocol message. 1×2 mode enabled. 17 unit tests.
- [x] PR #4 — Quad (2×2) mode, `useSlotFocusShortcuts` (Ctrl+1..4), Direct Mode breathing glow scoped to focused slot. 8 unit tests.
- [x] PR #5 — auto-collapse + survivor packing on close, polished EmptySlotPicker (large "+ 开新 session" CTA, already-attached gray-out + tooltip), backend duplicate-attach guard. 9 unit tests.
- [x] PR #6 — 4 backend wire-routing integration tests; README + ROADMAP updates.

**Definition of done**: desktop user clicks ⊞ → picks 1×2 → fills slot 1 from EmptySlotPicker → both panes stream live; clicks slot to focus, types in ComposeBar → message lands in focused pane; closes a slot → layout auto-collapses + survivors pack; Ctrl+1..4 cycles focus; Direct Mode glow follows the focused slot. Mobile is unaffected.

## Periodic WS communication optimization (ADR-0015, 2026-04-23)

**Goal**: shrink the always-on control-plane traffic so 4-slot desktop + multi-tab scenarios scale without wasted broadcasts. Three independent, individually-shippable optimizations.

- [x] PR #1 — Sysinfo frontend dedup. `useSysinfoStore.ingest` compares cpu/mem/load1/cores (3-digit rounded) against the prior sample; drops no-change updates to eliminate the 30 re-renders/minute during idle. Unit tests. (commit `32aa335`)
- [x] PR #2 — `tmux_state` JSON Patch (RFC 6902) delta broadcast. New `tmux_state_delta` variant + `resync_state` client message + `auth.capabilities.stateDelta` negotiation. Per-client last-sent snapshot; falls back to full state when patch ≥ 60% of full size. Uses `fast-json-patch`. Backend + frontend unit tests + integration round-trip test. (commit `18d3451`)
- [x] PR #3 — `forcePublish` microtask batching. Coalesce multiple `forcePublish` calls within one microtask tick into a single `publishSnapshot(true)`. Unit tests covering the burst scenario. (commit `5fc3c70`)

**Definition of done**: idle 2-tab 4-slot setup shows < 1 KB/s control-plane traffic (down from ~8 KB/s); mutation bursts produce 1 broadcast instead of N; old clients still receive `tmux_state` fallback unchanged.

## Frontend i18n (ADR-0016, 2026-04-23)

**Goal**: turn the mixed-zh/en hardcoded chrome into a 7-locale experience (en / zh-Hans / ja / ko / fr / es / de) with automatic detection + user override, via i18next.

- [x] PR #1 — Infrastructure: `i18next` + `react-i18next` + `i18next-browser-languagedetector` deps, `src/frontend/i18n/` scaffolding, `common.*` skeleton, LanguageSwitcher dropdown docked in the sidebar footer (compact variant ready for TopBar), TS type augmentation from `en.json`, `canonicalizeLocale` with `zh-CN/SG/HK/TW → zh-Hans` aliases. (commit `c5c7348`)
- [x] PR #2 — Extracted cleanly-committed `features/sessions/*` + `features/files/FileViewer`. FilePanel + SheetHost deferred until ADR-0014 lands so the two PRs don't collide on the same hunks. `tests/setup.ts` imports the i18n module so every Testing Library render resolves `t()` against English defaults. (commit `1e400c8`)
- [x] PR #3 — Extracted shell (TopBar + LayoutButton), auth (PasswordPrompt), direct-mode (Indicator), key-overlay (KeyOverlay), action-panel (PromptCaptureBanner), terminal (SlotFrame empty picker), compose (ComposeBar). `formatRelativeTime` intentionally stays compact (`15s / 3h / 2d`) — `Intl.RelativeTimeFormat` even in narrow style is over 2× the width and would break SessionList layout; header comment and ADR §6 addendum document the decision. (commit `2528899`)
- [x] PR #4 — Translated `ja / ko / fr / es / de` from the en.json canonical keys. `scripts/check-locales.ts` reports 0 missing keys across all 6 non-English locales. Informational only — does not exit non-zero, translation lag never blocks a release. (commit `0ef46db`)

**Definition of done**: a user opens the app, UI auto-picks their browser locale from the 7 supported; TopBar 🌐 button switches language without reload; Session / Files / Compose / TopBar are fully localized in all 7 languages; terminal content is untouched; `document.documentElement.lang` reflects the active locale.

## Workspace root sandbox + install UX (ADR-0017, 2026-04-23)

**Goal**: stop the session wizard's picker from browsing above an install-configured root, and compress the 5-step deployment flow into one script. Both tracks driven by product positioning ("agent control tool, not geek webshell") and surfaced after ADR-0014 users reported seeing `/etc` from the phone.

- [x] PR #1 — i18n cleanup: extracted ~72 hardcoded CN strings across FilePanel, NewSessionSheet, DirectoryPicker, FileViewer, CodeViewer, App DirectMode toggle, SlotFrame, ComposeFocusIndicator, file-panel-uploads, attachments-store. 7 locales translated. Fixed a de.json straight-quote collision. `ATTACHMENT_TEMPLATE_PREFIX` → `getAttachmentPrefix()` so the marker line the agent sees matches user locale. (commit `ca11a90`)
- [x] PR #2 — Backend workspace root: `RuntimeConfig.workspaceRoot` + `--workspace-root` CLI flag + `TM_AGENT_WORKSPACE_ROOT` env, default `os.homedir()`. `fs-picker/routes.ts` sandbox via `path.relative` + `..` detection, 403 on escape. `BrowseResponse` field `home` → `root`. **Mounted `/api/fs-picker` on the express app** (latent ADR-0014 bug — router was built but never `app.use`'d). `/api/config` exposes workspaceRoot. Backend tests cover root-escape + at-root parent=null. (commit `bbb9fdd`)
- [x] PR #3 — Frontend workspace root: new `server-config-store` holds the root; App.tsx fetches and populates; `DirectoryPicker` clamps the breadcrumb at root + `⌂ Root` jump button + auto-disables up-arrow via `parent=null`; `NewSessionSheet` default cwd reads from the store with `~` fallback for pre-0017 backends. (commit `748d341`)
- [x] PR #4 — `scripts/install.sh` one-shot installer: preflight (node+npm+systemctl+openssl), npm install --omit=dev + build, idempotent `/etc/tm-agent/env` (preserves token+password across reinstalls), systemd unit with `User=` + `HOME=`, enable + restart + is-active verification. `--non-interactive` for automation. CLI startup banner now TTY-aware ANSI and prints Workspace root + a heads-up about pinning token/password. README + deployment docs lead with the installer. No new dep — QR code scoped out. (commit `c67713a`)

**Definition of done**: (1) picker at the default install browses only under `$HOME`, `/etc` is 403. (2) A fresh VPS goes from `git clone` to "open URL + password" in a single `sudo ./scripts/install.sh` invocation; rerunning preserves the token/password so bookmarked URLs don't break.

## Subpath reverse-proxy deploy (ADR-0018, 2026-04-24)

**Goal**: kill the "must have a dedicated subdomain" limitation. One install, mountable at `/` or at any URL prefix (e.g. `/tmux/`) without rebuilding the frontend — the frontend resolves every REST/WS call relative to `document.baseURI`, which the backend rewrites in `<base href>` at serve time based on `--base-path`.

- [x] PR — runtime base-path: `RuntimeConfig.basePath` + `--base-path` CLI + `TM_AGENT_BASE_PATH` env; express routes + WS upgrade handler + static + SPA fallback all mounted under the normalized prefix; index.html served through a regex that rewrites `<base href="...">` to match. Frontend `lib/base-url.ts` exposes `apiUrl()` / `wsUrl()` built on `document.baseURI`; 9 call sites converted (config/files/fs-picker/shell-history APIs + control/terminal WS + `buildAuthedMediaUrl`). Vite `base: "./"` for build, `"/"` for dev. `scripts/install.sh` grows `--base-path` + stamps `TM_AGENT_BASE_PATH` into env. `docs/deployment/nginx.conf.example.subpath` pairs with it.

**Definition of done**: (1) existing subdomain deploy at your-host.example unchanged (basePath="" path). (2) adding `--base-path /tmux` and the subpath nginx template yields a working deploy at `https://host/tmux/` with REST + WS + assets all under the prefix.

## Tracking

Current phase: **ADR-0017 (workspace root sandbox + install UX) shipped end-to-end 2026-04-23** atop ADR-0015 + ADR-0016 from earlier the same day. ADR-0015 landed as three independent perf wins (sysinfo dedup, tmux_state JSON Patch deltas with capability negotiation, forcePublish microtask coalesce). ADR-0016 landed as four-PR i18n stack: i18next infra + 7-locale scaffolding + language switcher, sessions/files extraction for en+zh-Hans (minus the in-flight FilePanel/SheetHost staying on their ADR-0014 branch), remaining-feature extraction with a compact-unit decision for `formatRelativeTime`, and full ja/ko/fr/es/de translations with an informational `scripts/check-locales.ts` coverage report. Earlier: Desktop multi-pane tiling (ADR-0013) shipped 2026-04-22 with PRs 1–6 + 49 new unit tests + 4 backend integration tests covering wire-level slot routing. Sidebar File Panel (ADR-0012) shipped 2026-04-22; Phase 2.5 PRs 1–6 landed; `action_first` debug flag was removed 2026-04-21 in favor of auto-detecting touch devices via `matchMedia("(pointer: coarse)")` (ADR-0006 addendum); Phase 3a (session list + connection health) shipped earlier; Phase 2's scroll/freeze work stabilized with ADR-0005; Sidebar system status panel landed per ADR-0011; ComposeBar attachment + msg-upload rewrite for AI chat shipped same day as the sidebar Files tab.

Update this line when starting a phase. Open issues and PRs reference the phase by name for quick filtering.
