# 0006. Mobile action-first UI: shell-state classifier + top-drop key overlay

- Status: **accepted** (PR1–6 shipped; 2026-04-21 addendum: debug flag removed)
- Date: 2026-04-20 (revised 2026-04-21)
- Deciders: @ChuangLee
- Supersedes: partially supersedes Design Principle #3 ("Input is a docked compose bar above the virtual keyboard") for the **mobile** form factor only. Compose bar demotes from primary to fallback; it gains prompt capture, history, and draft stash in return.
- Targets: a new **Phase 2.5 — Mobile UX pivot**, to be inserted in `docs/ROADMAP.md` between 3a and 3b if accepted.
- Scope extension (2026-04-20, previously ROADMAP Post-v1 #8): **Desktop Direct Mode** is now part of Phase 2.5 as the desktop-side symmetric pivot. See §5.

## Context

Phase 1 shipped a compose bar as the primary mobile input surface. Design Principle #3 argued this is better than "tap terminal to summon keyboard" because the virtual keyboard eats ~40% of the viewport. That reasoning proves "not tap-the-terminal"; it does **not** prove "compose bar is the right primary surface."

What the current design implicitly assumes:

- Input is typing.
- Typing a command is the default motion.

What we actually observe in our own daily use:

- ~80% of tmux-using motions on mobile are repetitive commands (`ls`, `cd foo`, `git status`, `npm run dev`, `clear`) or single keys (`Enter`, `Ctrl+C`, `y`, `Esc`, `q`).
- The remaining ~20% splits into (a) genuine ad-hoc prose (edit commits, SSH one-liners) where typing is real, and (b) in-app keys (vim modes, pager navigation, TUI shortcuts) where "typing" is a fiction — it's keypresses masquerading as text.
- The virtual-keyboard + smart-keys work has **not** shipped yet. **This is the cheapest moment to rethink before we commit.**

Two observations unlock the pivot:

1. **xterm.js buffer is fully addressable at any time.** We can scan the last N rows for prompt patterns; we already have shell state as a first-class signal, we were just not reading it.
2. **tmux exposes `#{pane_current_command}`.** It is authoritative: "vim", "python", "claude", "bash". We can cheaply push it over the control channel.

Together, these two signals classify the current shell state deterministically enough to drive UI — no LLM required.

## Decision

Reframe mobile input from "compose bar" to "action-first." The primary mobile surface is a **shell-state-aware action panel** pinned above the terminal. Text input becomes a deliberate second-class gesture (`✎` → compose bar + system IME). A separate **top-drop semi-transparent key overlay** (invoked via `⌨`) surfaces low-frequency keys when the contextual panel isn't enough.

### 1. State classifier

Pure function consuming three signals; one of 8 states out.

| Signal               | Source                                                    | Refresh trigger                     |
| -------------------- | --------------------------------------------------------- | ----------------------------------- |
| `paneCurrentCommand` | backend pushes `#{pane_current_command}` per focused pane | on tmux pane-focus / command change |
| `altScreen`          | `term.buffer.active.type === 'alternate'`                 | on `onBufferChange`                 |
| `bufferTail`         | last 5 rows of `term.buffer.active` as a single string    | on `onWriteParsed`, 200ms debounce  |

States and detection rules (evaluated in this order — first match wins):

| State             | Rule                                                                                                         | Typical processes                |
| ----------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `password_prompt` | tail matches `(?i)(password\|passphrase).*:\s*$`                                                             | sudo, ssh, gpg                   |
| `confirm_prompt`  | tail matches `\[[yY]/[nN]\]\|\([yY]es/[nN]o\)\|continue\?\s*$`                                               | apt, pip, rm -i                  |
| `editor`          | `altScreen` && cmd ∈ `{vim, nvim, nano, micro, hx}`                                                          | text editing                     |
| `pager`           | `altScreen` && cmd ∈ `{less, more, man}` or git pager                                                        | `less`, `man`, `git log`         |
| `tui`             | `altScreen` && cmd ∈ `{claude, aider, htop, btop, lazygit, ranger, fzf, k9s, ...}` or unknown alt-screen cmd | full-screen interactive apps     |
| `repl`            | cmd ∈ `{python, node, bun, irb, ghci}` or tail matches `^(>>>\|\.\.\.\|\>\s\|In \[\d+\])`                    | interactive REPL                 |
| `long_process`    | non-alt, no prompt in tail, output activity within last 3s                                                   | `npm run dev`, `tail -f`, builds |
| `shell_idle`      | non-alt, tail matches `[\$›#»]\s*$`                                                                          | bash, zsh, fish                  |

Ambiguity is resolved by the order above (most specific first). Unknown / low-confidence → falls through to `shell_idle` with a `confidence: 'low'` flag; UI shows a small `?` badge and surfaces `⌨` more prominently.

Classifier is a pure function (`classify(signals): ShellState`). Its output feeds a Zustand slice; UI subscribes.

### 2. Context card panel (primary mobile surface)

A horizontal-scrolling strip pinned above the compose rail, content driven by state. Per-state card sets live in `state-definitions.ts`; see `docs/prototypes/mobile-action-first.md` for visual mocks of all 8 states.

Design rules:

- Card = `{label, payload, kind}`. `payload` is either a string to send (`"git status\n"`) or a named keypress (`Escape`, `Ctrl+C`).
- Tap = send immediately. Long-press = copy payload into compose bar for edit-then-send.
- Top-left card in every state is `⌨` (open key overlay). Top-right is `✎` (open compose bar).
- Learning: `shell_idle` cards include an auto-learned set from `~/.bash_history` (opportunistic pull on first `select_session`) plus user-pinned entries. Frequency-ordered, capped at 8 visible without scroll.
- State transitions animate the card strip: 180ms crossfade, no layout jolt.

### 3. Top-drop key overlay

Invoked via `⌨` card or a top-edge pull-down gesture (60px drag threshold). Slides down from the top, covers ~68vh, semi-transparent background (`rgba(12,14,18,0.78)` with `backdrop-filter: blur(6px)`). Keys themselves are opaque for readability.

Crucial spatial choice (see conversation log 2026-04-20): **drops from top, not bottom**. Rationale:

- Physically differentiates from the system IME (which comes from the bottom).
- Leaves the bottom ~32vh of live shell visible and un-obscured — that's where the cursor and prompt live.
- User can see both the overlay and the terminal's active zone simultaneously.

Internal layout follows **reverse-priority** (higher-frequency keys near the bottom of the overlay, i.e. closer to the user's thumb since the overlay drops from top but thumbs reach from bottom):

```
┌─ pull handle ────────────────────────┐  (small)
│ state-contextual keys (vim: :w :q :wq │
│   gg G / )                            │
│ ─── modifiers ───                     │
│ [Ctrl] [Alt] [Shift]  (sticky arm)    │
│ ─── navigation ───                    │
│     ↑                                 │
│   ← ↓ →                               │
│ ─── high-frequency ───                │  (larger, thumb-reach zone)
│ [Esc] [Tab] [Enter] [Backspace]       │
│ [ | ] [ ~ ] [ / ] [ > ]               │
│                         [✎ compose]   │
└───────────────────────────────────────┘
```

- Modifiers are sticky-armed: tap `Ctrl` → amber border → next key sends combo, then auto-releases. Long-press locks (second long-press unlocks).
- Dismissal: tap anywhere in the visible bottom-32vh shell area, upward swipe on overlay, or tap `✎` (transitions to compose mode; overlay dismisses, IME rises).
- The top overlay and the system IME cannot coexist — opening compose mode auto-dismisses the overlay.
- Animation: 180ms `translateY(-100% → 0)` + opacity. Skipped under `prefers-reduced-motion`.

### 4. Compose bar as product

Compose bar retains its role (edit-before-send with system IME) and gains:

- **Prompt capture banner** — when state is `confirm_prompt` or `password_prompt`, a banner above the compose bar shows "Script is waiting: [Y/n]" with big Yes/No buttons (or a native `type=password` field). Banner auto-dismisses when the prompt resolves (tail no longer matches).
- **Per-session command history** — up-arrow on empty compose bar (or swipe up inside the bar) steps backwards through history. History sources: (a) in-memory record of what this session's compose bar sent, (b) opportunistic `~/.bash_history` pull on first need. State-filtered: in `editor` state, history shows only `:`-prefixed entries.
- **Draft stash** — compose bar contents persist per session in Zustand (in-memory only; not persisted across reloads in v1).
- **Quick insert tray** — long-press compose bar opens a small tray with {last URL, last path, current git branch} extracted from recent buffer output via regex. Deferred to v1.1 if implementation time is tight.

### 5. Desktop

Desktop keeps the current two-column grid + compose bar as the **default mode**. **ActionPanel renders on desktop** in a compact layout (see §5.1) — the "visible current state + one-click frequent commands + prompt capture" value carries over from mobile. **KeyOverlay does not render on desktop** — PCs have physical keyboards; the gap it fills on mobile is already covered by real keys. The desktop's "low-frequency key direct path" + "visual focus" combo is §5.2 **Direct Mode**.

#### 5.1 Desktop ActionPanel (compact)

- **Position**: a slim horizontal row 40px tall, sitting between TopBar and Surface. Not in the sidebar — it would crowd the session list.
- **Content**: same 8-state card sets as mobile, same copy, but denser — 28px-tall cards with 10px horizontal padding, UI font 13px, single row; overflow scrolls horizontally without a visible scrollbar.
- **Keyboard shortcuts**: the first 9 cards bind to `Alt+1` … `Alt+9` (avoids the browser's `Ctrl/Cmd+<digit>` tab-switch). Shortcut badge shown on hover.
- **PromptCaptureBanner**: replaces the ActionPanel row when state is `confirm_prompt` / `password_prompt`. Height auto (48–80px), same styling as mobile but not full-bleed. Password banner uses the native `<input type="password">` (no virtual-keyboard concern on PC).
- **Direct Mode interaction**: ActionPanel is part of the blurred UI set along with TopBar / Sidebar — consistent visual focus on Surface; restores when leaving Direct Mode.
- **Hidden when**: viewport < 820px (drops to mobile layout), or user disabled (`localStorage.action_panel_desktop === '0'`, default on).

#### 5.2 Desktop Direct Mode

Direct Mode is a one-click toggle into "keyboard drives the PTY directly." When on, browser-level keydown events route straight to bytes on the PTY; the visual treatment blurs the non-shell UI and adds a motion indicator so the user always knows "you are directly controlling the terminal."

**Detection**: `matchMedia('(min-width: 820px) and (pointer: fine)')` — Direct Mode button only shows on true PCs. Touch-primary wide screens (iPad landscape) don't get it by default but can enable via `?direct_mode=1` URL param.

**Why Direct Mode is PC-only**: on mobile, the virtual keyboard is tightly coupled to input focus — any focused `<input>` / `<textarea>` summons the keyboard and consumes ~40% of the viewport; remove focus and the keyboard disappears together with keyboard events. "Capture keystrokes without displaying an input box" is not achievable on iOS / Android. Mobile's functional equivalent is already covered by the action-first UI (compose bar + card strip + KeyOverlay); a separate Direct Mode would be redundant and non-implementable.

**Enter**: a "Direct Mode" button in the desktop TopBar (top-right) toggles it; or cold-start with `?direct_mode=1`.

**Exit**: same button (label flips to "Exit Direct Mode"); or `Ctrl+]` (traditional telnet/ssh escape sequence, almost never bound by shells or editors); or Esc pressed twice within 300ms. All three coexist; the on-screen indicator advertises `Ctrl+]`.

**Visual guidance**:

- `Surface` (`.tm-scroller`) stays 100% clear — no filter.
- Everything else (TopBar body, Sidebar, ActionRail, any floating layer) gets `filter: blur(4px) grayscale(30%) opacity(0.4)` with `pointer-events: auto` preserved (still clickable, but visually recedes).
- Surface gets a breathing `box-shadow` glow (`--accent` color, 3s loop animation).
- A 40px floating bar slides into the top: accent background, dark text "Direct Mode · `Ctrl+]` to exit", with an 8px pulsing dot on the left.
- Enter/exit transitions are 200ms ease — no hard cut.

**Keyboard capture**:

- `document`-level `keydown` listener at the capture phase; in direct-mode state, `preventDefault` + `stopPropagation` on most combos. Allowed through:
  - Browser-reserved keys (`Cmd+T/W/R/Q`, `F11`, `F12`, devtools etc.) — these physically can't be captured by JS.
  - `Ctrl+]` and double-Esc — consumed internally as "exit," not forwarded to PTY.
- Other keys → mapping table → PTY bytes (letters/numbers/control/arrows/Fn keys each have xterm/ANSI encodings; reuse xterm.js's key-to-bytes logic).

**IME support**:

- In direct-mode, focus a hidden `<textarea>` to receive keystrokes and use its `compositionstart/update/end` events for IME.
- During composition: do NOT forward keydown to PTY; render a small floater near the cursor showing candidate text.
- On `compositionend`: ship the composed string to the PTY in one payload.
- v1 supports English direct + Chinese IME; Japanese/Korean compatibility is PR6 v1.1.

**Mouse**: **not** forwarded, consistent with ADR-0005. Mouse support (tmux copy-mode, vim mouse selection) would be a separate ADR.

**Known limits** (browser security model, not bugs):

- Browser-reserved keys (`Cmd+Q/W/T/R`, `Ctrl+W`, `F11`, `F5`, `Alt+Tab`, OS-level shortcuts) can't be captured.
- Right-click menu stays enabled — disabling it would feel trap-like; user expects an exit.
- Fullscreen API is optional: `?direct_mode=fullscreen` requests `requestFullscreen()` on enter; default doesn't, to avoid a permission prompt.

**Paste**:

- In direct-mode, `Ctrl+V` / `Cmd+V` is captured via `paste` event and written directly to the PTY (compose path unused).
- Not a contradiction with ADR-0005's "Input unchanged" — direct-mode is a **new** input path; the compose-bar path stays intact.

## Execution flow

This ADR proceeds through six gated phases. Each phase produces a concrete deliverable; the next phase cannot start until the previous lands and is reviewed.

| #   | Phase                   | Deliverable                                                                                                                                                                   | Gate                                                                                                                                         |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 调研 Research           | `docs/research/0006-mobile-action-first-research.md` — feature survey (tmux-mobile + ttyd/wetty/gotty) + empirical verification that the classifier signals behave as claimed | Classifier accuracy ≥ 90% on a curated list of ≥ 30 real prompts spanning the 8 states; survey produces a concrete "borrow" / "reject" table |
| 2   | 计划 Plan               | Phase 2.5 block inserted into `docs/ROADMAP.md`: PR-by-PR sequence, rollback flag, acceptance criteria per milestone                                                          | Owner agrees milestones are shippable independently behind `action_first` flag                                                               |
| 3   | 产品设计 Product design | `docs/prototypes/mobile-action-first-v0.1.html` — deployable interactive HTML mock at `/preview/mobile-action-first-v0.1.html`; per-state copy + tap-target dimensions locked | Owner taps through all 8 states on a real phone and signs off                                                                                |
| 4   | 技术设计 Tech design    | `docs/design/0006-mobile-action-first-tech-design.md` — component APIs, state-machine spec, wire-protocol delta (Zod diff), debug-flag mechanism                              | Types and protocol additions reviewed; test fixtures scoped                                                                                  |
| 5   | 开发 Implementation     | 5 PRs behind `action_first` debug flag; see §Implementation notes + Phase 2.5 milestones in ROADMAP                                                                           | Each PR green on CI, deployed to `your-host.example`, exercised on phone                                                                     |
| 6   | 测试 Testing            | Unit (classifier table-driven) + integration (panel + overlay + compose interactions) + Playwright e2e across 8 states with screenshots                                       | 8-state Playwright suite green; password-path isolation asserted                                                                             |

The gates are strict: if Research shows the classifier can't cleanly hit 90% on real prompts, the state list must be revised **before** planning; if Product design reveals a missing interaction, tech design must absorb it before any code ships.

## Alternatives considered

- **Polish the existing compose bar + smart-keys row (current trajectory, Phase 4).** Rejected. Optimizes the wrong primary. 80% of mobile interactions are non-textual but the surface pretends they are.
- **LLM-based state classification.** Rejected. Adds latency, cost, and dependency. Regex + `pane_current_command` gets 95%+ accuracy on the 8 states we care about. Reassess if the long tail becomes a pain point.
- **Always-visible smart-keys row (no drop-down overlay).** Rejected. Reserves permanent screen space for low-frequency keys. Overlay keeps the terminal surface maximally visible by default.
- **Bottom-slide overlay (familiar iOS sheet pattern).** Rejected. Conflicts physically with the system IME (also from bottom) and hides the interaction zone. Top-slide is a clearer mental model.
- **Prefix-key chord menu in the UI.** Rejected by DESIGN_PRINCIPLES #4 and unchanged here — prefix is a desktop-keyboard relic, not exposed in the UI.
- **Defer to Phase 4 / v1.1.** Rejected. The virtual-keyboard + compose-bar work hasn't shipped; changing the primary model now is cheap. Deferring means locking a primary we believe is wrong.

## Consequences

**Easier:**

- Less typing on mobile. Primary motion becomes "tap a card" for high-frequency actions.
- Interactive CLI prompts (y/N, password) get first-class UI. Today they are easy to miss (buried in scrollback).
- Per-state key sets surface keys that were previously reachable only through awkward typing — vim `:wq` is a visible card while in vim, not a 4-keystroke compose-bar motion.
- Shell state becomes observable: the user always knows "the app thinks I'm in vim" because the card strip shows vim cards. Debugging misbehavior is cheaper.

**Harder:**

- **Classifier correctness matters.** Wrong state → wrong cards → user confusion. Mitigation: conservative defaults (unknown → `shell_idle`), visible state badge in the top bar, `⌨` always reachable as an override.
- **More frontend state.** One regex eval per rAF tick + one string compare on tmux event. Measured cost: negligible (<0.1ms per tick in a spike).
- **More UI surface.** 8 states × (card set) + overlay + compose enhancements ≈ 10-12 distinct screens. Prototype doc addresses the up-front mocking cost.
- **Testing burden.** Each state needs a Playwright fixture that reproduces its detection inputs (buffer tail + mock `pane_current_command`). Reusable via buffer injection helpers.
- **Backend change (small).** `#{pane_current_command}` must be pushed over the control channel on focus change. See Implementation notes.

**Locked (if accepted):**

- Mobile primary input surface is action cards. Compose bar is fallback.
- DESIGN_PRINCIPLES.md #3 is amended. New text to replace the "Consequence" paragraph:
  > On mobile, typed input is a deliberate fallback behind action cards driven by shell state. The compose bar is reachable via `✎` and rises above the virtual keyboard via VisualViewport as before. On desktop, the compose bar remains the primary input surface until a Direct Mode ADR says otherwise.
- New invariant: **shell state is first-class UI state.** Any change to xterm subscription or tmux control wiring that breaks classifier signals is a breaking change.

## Implementation notes

**Module layout:**

```
src/frontend/features/
  shell-state/
    classifier.ts         ← pure: (signals) => ShellState
    state-definitions.ts  ← enum + per-state metadata + card lists
    use-shell-state.ts    ← hook: subscribes to term + control-ws
  action-panel/
    ActionPanel.tsx       ← horizontal card strip
    Card.tsx              ← single card (tap + long-press)
  key-overlay/
    KeyOverlay.tsx        ← top-drop sheet
    key-layout.ts         ← state → key priorities
  compose/
    ComposeBar.tsx        (extended)
    PromptCaptureBanner.tsx
    history-store.ts
    draft-store.ts
```

**Backend change:**

- `src/backend/tmux/tmux-gateway.ts`: extend `listPanes`' format string to include `#{pane_current_command}`. Push the value on every snapshot update.
- Control wire: add `pane_current_command: string` to `paneSummary` (Zod schema in `src/shared/protocol.ts`).
- No PTY or attach-logic change.

**Classifier pseudocode:**

```ts
export function classify(s: Signals): { state: ShellState; confidence: "high" | "low" } {
  if (PASSWORD_RE.test(s.tail)) return { state: "password_prompt", confidence: "high" };
  if (CONFIRM_RE.test(s.tail)) return { state: "confirm_prompt", confidence: "high" };
  if (s.altScreen) {
    if (EDITOR_CMDS.has(s.cmd)) return { state: "editor", confidence: "high" };
    if (PAGER_CMDS.has(s.cmd)) return { state: "pager", confidence: "high" };
    if (TUI_CMDS.has(s.cmd)) return { state: "tui", confidence: "high" };
    return { state: "tui", confidence: "low" };
  }
  if (REPL_CMDS.has(s.cmd) || REPL_PROMPT_RE.test(s.tail))
    return { state: "repl", confidence: "high" };
  if (PROMPT_RE.test(s.tail)) return { state: "shell_idle", confidence: "high" };
  if (Date.now() - s.lastOutputTs < 3000) return { state: "long_process", confidence: "high" };
  return { state: "shell_idle", confidence: "low" };
}
```

**Rollback plan:** the action panel, overlay, and shell-state slice are new feature directories. Existing ComposeBar and TopBar are untouched except a visibility toggle. A debug flag `action_first: false` restores the Phase 1 UI. Ship Phase 2.5 across 3-5 PRs: (a) classifier + backend signal, (b) action panel for `shell_idle` + `editor`, (c) remaining 6 states, (d) key overlay, (e) compose enhancements.

**Test additions:**

- Unit: `classify()` table-driven tests — one row per (state, inputs) pair, including ambiguity tie-breaks.
- Integration: action panel re-renders on state change; keyboard overlay dismisses on compose open.
- E2E (Playwright): open vim → verify `:wq` card appears → tap → buffer reflects save-and-quit; invoke `apt install` prompt → verify big Yes/No buttons → tap Yes → confirm flow completes.

## Addendum 2026-04-21 (#3) — Mobile: stop rendering ActionPanel entirely

**Decision:** `ActionPanel` returns `null` when `!isDesktop`. Mobile no longer has a persistent card strip; all state-contextual keys live inside `KeyOverlay` (opened from the TopBar `⌨` button). Desktop is unchanged — Alt+1-9 shortcuts + the slim strip are preserved.

**Motivation:**

1. Even with 1–2 cards (e.g. `long_process` → `⏹ Ctrl+C`), ActionPanel still consumed 113 px of vertical space on iPhone viewports. Mobile vertical real estate is scarce; this was pure loss.
2. `KeyOverlay`'s `ContextualBand` already covers the essential per-state keys (`long_process` → Ctrl+C, `editor vim` → :w/:q/:wq/gg/G/, `pager` → Space/b/q, etc.). For the mobile use case, ActionPanel and KeyOverlay are functionally redundant.
3. Trade-off: mobile loses the `shell_idle` convenience cards (`ls` / `git status` / `npm run dev` / `cd ..` / learned history). Deliberate — mobile usage leans on "observe + single-key response"; long command entry belongs in the compose bar anyway. If we later need a mobile quick-command list, fold it into KeyOverlay's contextual band.

**Implementation:** `ActionPanel.tsx` short-circuits early with `if (!isDesktop || bannerState || cards.length === 0) return null`; `data-layout` becomes a hard-coded `"desktop"`; `shortcutIndex` drops its `isDesktop &&` guard. Unit test's "mobile viewport" case inverts to assert null; e2e `phase2_5_pr2` mobile test inverts to `toHaveCount(0)`.

## Addendum 2026-04-21 (#2) — Drop the top-edge gesture; add an explicit TopBar button

**Decision:** remove `useTopEdgePull` and `useCoarsePointer`; also drop the mobile-only `⌨` card from `ActionPanel`. The single entry point for `KeyOverlay` on mobile is a new `⌨` button rendered in `TopBar`'s right slot, gated by Tailwind's `md:hidden` so desktop (which has a physical keyboard) never sees it.

**Motivation:**

1. Real-device testing confirmed that any mobile pull-down is swallowed by the scroll container's native kinetic engine — users have no way to discover a "start in the top 20 px, drag ≥ 60 px" gesture. **Zero discoverability.**
2. The `⌨` card sat at the tail of the ActionPanel among state-specific cards, visually indistinguishable from them.
3. The TopBar right slot was empty except when direct-mode was available. Dropping a `⌨` button there costs near-zero visual real estate and gives mobile users an obvious "soft keyboard" entry point.

**Implementation:** `TopBar` gains an `onRequestKeyOverlay` prop; it renders a `⌨` button with `md:hidden`, `aria-label="打开按键层"`, `data-testid="topbar-key-overlay"`. `ActionPanel` no longer takes `onRequestKeyOverlay`; the `.tm-card-kbd-toggle` CSS class is deleted.

## Addendum 2026-04-21 — Remove the `action_first` debug flag

**Decision:** drop the `useActionFirstFlag()` hook, the `?action_first=` URL parameter, and the `tm-agent_action_first` localStorage switch. `ActionPanel` / `KeyOverlay` / `PromptCaptureBanner` no longer check any flag. ~~The top-edge-pull gesture auto-gates on `matchMedia("(pointer: coarse)")` — only touch-primary devices receive it; mouse-primary devices never trigger it regardless of viewport width.~~ (**Superseded by the addendum above**: the gesture is removed entirely; a TopBar button replaces it.) Desktop Direct Mode is independent of this change and continues to be gated by its own `directMode.available` check.

**Motivation:**

1. After PRs 1–6 all merged, the flag in practice gated exactly one thing: whether `useTopEdgePull` was active. `ActionPanel` and friends were already rendering unconditionally. The flag had shrunk to "a gesture switch", and the rollout-gate rationale was long gone.
2. **This violated the spirit of Design Principle #1.** UX should be decided by what the device is, not by a hidden URL parameter or localStorage key. A personal tool should not have a maintainer-facing "deployment switch".
3. `matchMedia("(pointer: coarse)")` is a CSS Media Queries Level 4 standard, supported on iOS Safari 13+ and Android Chrome 58+ — i.e. every mobile browser this project targets. Laptops with both a mouse and a touchscreen report coarse, which is the behaviour we want (if the user can pull the gesture, let them).
4. Phase 2.5's Definition of Done required "flag flipped on + Playwright 8-state suite green". Pulling the flag folds "flip + verify" into a single step. Personal project, has been on `main` for days — we accept "it just is" with no emergency revert button.

**Side effects:**

- The sections of `docs/plans/0006-phase-2.5-plan.md` and `docs/design/0006-mobile-action-first-tech-design.md` that describe `useActionFirstFlag()` are left as historical record. Future readers should take this addendum and the current code as the authoritative spec.
- The "Rollback plan" in the original ADR body that relied on `action_first: false` no longer exists. Phase 1's compose-bar-primary UI is not recoverable by flag-flip — if a regression appears, only commit-level revert of specific features is available.

## Open questions deferred

- **Q1 — Persistence of pinned cards.** v1: in-memory Zustand. v2: server-side JSON. Defer until usage proves it matters.
- **Q2 — Password field isolation.** Ensure sent bytes are not stored in compose history or draft stash. Test explicitly.
- **Q3 — Multi-pane state.** Each pane has its own state; action panel follows focus. If user swipes between panes, classifier re-runs on new pane's tail+cmd+altScreen.
- **Q4 — Accessibility.** Overlay focus-trap and arrow-key navigation for desktop screen-reader users (even though overlay is mobile-default, tablet landscape may hit it). Respect `prefers-reduced-motion`.
- **Q5 — Card learning source.** v1 uses `~/.bash_history` opportunistically; per-pane `HISTFILE` is a v2 refinement.
- **Q6 — Desktop symmetry.** The `⌨` overlay could double as a Ctrl-/ palette on desktop. Out of scope; see ROADMAP #8.
