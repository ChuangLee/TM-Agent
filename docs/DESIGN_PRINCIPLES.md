# Design Principles

TM-Agent is the precision console for the agent era: it keeps long-running AI agents inside tmux, where they are durable and inspectable, then gives the user a low-friction control surface from phone and desktop. The product should reduce unnecessary model mediation, not add another agent layer between the user and the terminal.

Five rules distilled from first-principles analysis of what breaks when tmux meets touchscreens and agent supervision. All UX decisions defer to these. Any deviation requires an ADR with an exception rationale.

## 1. A pane is a card, not a tile

Desktop tmux slices the screen into matrix-like rectangles. On a 400 px phone, two side-by-side panes are both unreadable. The assumption "multiple panes visible simultaneously" does not carry over to mobile.

**Consequence**: The same-window panes in TM-Agent are a **horizontally swipeable stack**, not a tiled layout. Only one pane is on screen at a time; the others are indicated by a dots strip. Splitting a pane doesn't split the screen—it adds a card.

Desktop is allowed to reflow into a multi-session command deck because it has the pixels and physical keyboard for precise parallel supervision. Mobile stays one readable pane at a time.

## 2. Scrolling is the universal gesture; history is not a separate surface

The prior tmux-mobile opened scrollback as a popup modal. An earlier draft of this doc split it into a distinct "history layer" revealed by pull-down. Both violate the iOS/Android mental model that **"up is older, down is newer"** should be one continuous gesture—the same one you use on every webpage, chat, and feed.

**Consequence** (see ADR-0004): the live surface is wrapped in a virtual scroll container whose native kinetic scroll drives xterm's viewport. At attach time we seed xterm's scrollback with the pane's recorded history, so scrolling up past the top of the live frame continues smoothly into older output. There is no gesture that opens "a different view"—scrolling is scrolling.

The freeze-and-select flow (ADR-0003) is a distinct action (long-press) because its purpose is different (stop the moving target to select), not because "select text" is a different _surface_ from "read text."

This also gives selection and copy free access to native browser primitives, which canvas alone cannot provide. See principle 5.

## 3. Input is a docked compose bar above the virtual keyboard

Tapping the middle of the terminal to summon a keyboard is a desktop-mouse metaphor. On mobile, where the virtual keyboard occupies 40% of the viewport, it's hostile: the area you want to see is the area the keyboard covers.

**Consequence**: A compose bar is permanently docked at the bottom of the main view. It stays above the virtual keyboard via `VisualViewport` API. Enter sends. Shift-Enter inserts newline. A toggleable smart-keys row (Esc, Tab, arrows, pipes, ctrl) sits above it for keys a mobile keyboard hides.

A side benefit: the user can _edit before sending_, which is hugely valuable on a shaky mobile keyboard.

## 4. Tmux state is top-level app navigation

Sessions and windows are nouns the user cares about. In the agent era, a session is often "Claude Code on frontend", "Codex running tests", "Gemini reviewing docs", or "logs tail". `prefix s` (session picker) and `prefix 0–9` (window jump) hide those nouns behind a chord. That chord is painful on a virtual keyboard and too slow for multi-agent supervision.

**Consequence**:

- **Sessions** = an always-accessible drawer on mobile (hamburger), a permanent sidebar on desktop. Each session is a card with name, attached status, last-active, preview line. Left-swipe = kill.
- **Windows** = dot indicators in the top bar, swipeable left/right. Long-press the title = session picker shortcut.
- **Panes** = horizontal card stack inside the surface.
- **Commands** (new window, split, kill, rename, detach, copy screen) = a one-tap grid behind a ⌘ button.
- **Agent affordances** (new Claude Code / Codex / Gemini / Hermes session, slash commands, attachment path injection) live around the terminal. They never replace tmux as the source of truth.

The `prefix` key is not exposed to the user. Internally, we call tmux's control commands directly via the `TmuxGateway`.

## 5. xterm.js renders the live frame; DOM layers handle every user interaction on text

xterm.js has ten years of work behind it—ANSI parsing, cursor positioning, alt-screens, wide chars, emojis. Don't rewrite it. But don't ask it to do things it was never designed for, either: native touch scroll, native text selection, mobile pinch gestures.

**Consequence**: we run a **canvas / webgl / dom xterm** for live rendering _and_ a family of **DOM mirror layers** that consume the same ANSI→HTML renderer. Each layer does one job:

- **LiveLayer** (xterm): paints the current frame. Does not own vertical scroll, horizontal swipe, or long-press—those are routed up to the AppShell.
- **ScrollMirror** (DOM, always active): a transparent-text overlay over the visible xterm window. Gives native selection for whatever's visible. Its existence makes native kinetic scroll usable for reading and copying (see ADR-0004).
- **FreezeLayer** (DOM, on-demand): rendered instantly from xterm's in-memory buffer when the user long-presses. Native selection with a fallback floating menu if the OS doesn't honor programmatic selection handles. See ADR-0003.

All DOM layers **share one ANSI parser and one HTML renderer** (lib/ansi). Fix a bug there once, every layer benefits. The font stack is the same across every layer (LiveLayer included), so a character at (col, row) in xterm is pixel-aligned to the same cell in any DOM mirror.

History is populated into xterm's own scrollback at attach time from `capture-pane -e -p -S -N`; there is no separate HistoryLayer component.

This clean split lets each layer use the mechanism it's best at, without any layer re-implementing the work xterm already does.

---

## Corollaries

- **No prefix-key chord in the user-facing language.** Internally, yes; in the UI, never.
- **No feature is "phone-only" or "desktop-only"**—the viewport is a layout parameter, not a product axis.
- **Mouse drag = pointer down + move.** Pointer Events are the single gesture abstraction. No duplicated touch/mouse handlers.
- **Selection is the user's; we never steal it.** If the OS wants to open a text-selection menu on long-press, we don't interfere.
- **Agent output remains terminal output.** We optimize observation and control, but we do not parse every agent into a proprietary chat transcript.
- **Token discipline is a UX feature.** If the user can answer a question by reading raw tmux output, do not force a model-mediated summary.
