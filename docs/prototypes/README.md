# Prototypes

Static HTML prototypes used to validate interaction design before writing production code. These are **not** the codebase—they're pinned snapshots that illustrate intent.

## Catalog

### `pc-direct-mode-v0.1.html`

Prototype for the Phase 2.5 desktop Direct Mode mode (ADR-0006 §5 / PR6). Static HTML, no backend.

Demonstrates:

- Desktop two-column layout (sidebar + top bar + slim action panel + surface + compose bar).
- **Desktop ActionPanel** (40px slim row below TopBar) with per-state cards, state picker dropdown in TopBar, `Alt+1..9` keyboard shortcuts bound to the first 9 cards, hover-shown shortcut badges, "hide action panel" toggle.
- `confirm_prompt` / `password_prompt` states: ActionPanel row swaps to a compact PromptBanner.
- "Direct Mode" (直通模式) toggle button in top-right of the TopBar.
- On enter: non-Surface UI blurs (`filter: blur(4px) grayscale(30%) opacity(0.4)`), Surface gets a breathing accent glow (`box-shadow` animation), a fixed top banner displays "直通中 · 按 `Ctrl+]` 或连按两次 `Esc` 退出" with a pulsing indicator dot.
- Keyboard capture: `keydown` maps to bytes (including Ctrl+ letter combos, F1-F12, arrows, PageUp/Down etc.). Toast displays the resolved byte sequence for visual validation.
- Exit: the toggle button, `Ctrl+]`, or double-Esc (within 300ms).
- IME bridge: a hidden `<textarea>` captures composition; a floating candidate tooltip appears near the cursor during composition, and the composed string is sent on `compositionend`.
- URL `?direct_mode=1` cold-starts in Direct Mode mode.

**Deployed at**: `https://your-host.example/preview/pc-direct-mode-v0.1.html`

**Not wired**: real WS, actual tmux. Key/paste events emit toast. Purpose is visual + interaction validation on a real desktop browser.

Associated specs:
- [ADR-0006 §5](../adr/0006-mobile-action-first-ui.zh.md)
- [产品规格 §11](../design/0006-mobile-action-first-product-spec.md)
- [技术设计 §13](../design/0006-mobile-action-first-tech-design.md)

### `mobile-action-first-v0.1.html`

Prototype for the Phase 2.5 action-first UI (ADR-0006). Static HTML, no backend.

Demonstrates:

- 8 shell states switchable via a top debug bar (`shell_idle`, `long_process`, `editor`, `tui`, `repl`, `pager`, `confirm_prompt`, `password_prompt`).
- ActionPanel card strip with per-state cards (tap = send, long-press → fill compose).
- PromptBanner for confirm (Yes/No buttons) and password (native `<input type=password>` + show toggle).
- ActionRail with `⌨` / `✎` / conditional arrow keys.
- KeyOverlay (top-drop, semi-transparent, sticky modifiers with armed/locked states, collapsible F1-F12, arrows cluster, high-frequency thumb-zone keys).
- Top-edge pull-down gesture to open overlay; swipe-up / bottom-tap to close.

**Deployed at**: `https://your-host.example/preview/mobile-action-first-v0.1.html`

**Not wired**: real WS, actual tmux; taps show toast "sent: ..." instead. Purpose is visual + interaction validation on a real device.

Associated specs:
- [ADR-0006](../adr/0006-mobile-action-first-ui.zh.md)
- [产品规格](../design/0006-mobile-action-first-product-spec.md)
- [研究报告](../research/0006-mobile-action-first-research.md)

### `mobile-shell-v0.4.html`

First end-to-end mobile + desktop shell prototype. Demonstrates:

- Top bar with toggle-state buttons for sessions drawer, history, smart keys, commands.
- Pull-down-to-history gesture with native DOM scroll and text selection.
- Session drawer (mobile) / permanent sidebar (desktop ≥ 820 px).
- Pane carousel (horizontal swipe on surface).
- Compose bar + collapsible smart-keys bar.
- Command bottom sheet.
- Pointer Events (works with both touch and mouse).
- Keyboard shortcuts (Enter / Esc / Ctrl-K / Ctrl-↑ / Ctrl-B / Ctrl-/ / Alt-arrows).

**Validated with**: the author on iPhone Safari, Android Chrome, desktop Chrome/Firefox at widths from 320 px through 1920 px.

**Known lessons encoded in code comments and `DESIGN_PRINCIPLES.md`**:

1. CSS media queries overriding base rules must come *after* the base rules in source order—equal specificity, later wins.
2. xterm.js cannot own native text selection; history must be a separate DOM surface.
3. `@use-gesture` or a raw Pointer Events wrapper is necessary—touch events alone lose desktop mouse support.

## How to view locally

```bash
python3 -m http.server -d docs/prototypes 8000
# then open http://localhost:8000/mobile-shell-v0.4.html
```

Or deploy to any static host. In our reference deployment it is served at `https://your-host.example/preview/`.

## Versioning

Prototype files are immutable once committed. New iterations get a new `-vX.Y.html` filename. Keep history so we can reference earlier decisions.
