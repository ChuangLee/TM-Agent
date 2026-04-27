# 0004. Native touch scroll via virtual container + DOM mirror

- Status: accepted
- Date: 2026-04-19
- Deciders: @ChuangLee
- Related: design principle 5; ADR-0003 (freeze-and-select); obsoletes the separate HistoryLayer concept described in the initial architecture.

## Context

Touch scrolling on the live terminal is a **core, non-negotiable** requirement for TM-Agent. It cannot be a pull-down-into-a-different-view workaround. The user expects: put a finger on the terminal, drag up, content scrolls with native iOS/Android kinetic physics, including rubber-band at edges and fling decay.

Five directions were surveyed:

1. **JS momentum simulation** on xterm's own scrollback (`term.scrollLines` on an animation loop). Works mechanically but feels uncanny-valley—no browser-engineer will ever match the polish of the real scroll machinery, especially given per-OS differences.
2. **Virtual scroll container driving xterm's viewport** via `scroll` events. Native scroll engine, kinetic for free. xterm continues to render only what's visible.
3. **Option 2 + transparent DOM mirror** over the canvas so native text selection works on whatever's visible during/after a scroll.
4. **On-touch-only DOM activation**: option 3's DOM layer exists only while a finger is on the surface; fades out otherwise. Cheaper but adds a 1-frame materialization delay.
5. **Iframe-based sandbox scroll** (let an inner document scroll itself). Rejected as a curiosity—same canvas-selection problem inside the iframe, higher cost.

A parallel question: where does "history" (tmux's recorded scrollback) live? Previously architected as a separate HistoryLayer populated on demand from `capture-pane`. If we adopt a native scroll container over xterm, the same container can scroll back through xterm's _own_ scrollback—so if we seed xterm's scrollback with the pane's history at attach time, scrolling up through old output is the same motion as scrolling up through recent output. HistoryLayer dissolves into the main scroll.

## Decision

Adopt **option 3 with eager history seeding**:

```
Surface
└── .scroller       (overflow-y: auto; touch-action: pan-y; native scroll lives here)
    ├── .viewport  (position: sticky; top: 0; height: 100%)
    │   ├── .live                xterm's renderer
    │   └── <pre class="mirror"> DOM shadow of the current visible window
    └── .spacer    (height = (bufferLength − rows) × cellHeight; extends the scroll range)
```

**DOM order is load-bearing.** Viewport comes _before_ the spacer. `position: sticky` only sticks once the element's natural position would scroll past the boundary — with spacer before viewport, the viewport is naturally below the fold and stays hidden until scrollTop ≥ spacerHeight, so scrolling back into history slides the terminal off-screen entirely. Viewport first + spacer after keeps the terminal visible at every scroll position; the spacer trails it and supplies the scroll range.

**Scrolling**: the browser scrolls `.scroller` natively. A `scroll` listener, rAF-throttled, computes the top-of-viewport line and calls `term.scrollToLine(n)`. xterm redraws its visible window. The DOM mirror re-renders the same lines via the shared ANSI→HTML renderer from ADR-0003.

**Selection**: `.mirror` has `user-select: text` and `color: transparent`. The user sees xterm's canvas colors; long-press triggers native browser selection on real DOM text. Selection highlight (browser-painted) sits above the canvas because the mirror is above the canvas in z-order.

**History seeding**: on attach, before the live PTY stream is connected, the backend runs `capture-pane -e -p -S -<historyLimit> -E -1` and pushes the result to the client. `-E -1` stops at the last line of history, _excluding_ the currently-visible pane, so the live PTY's attach-refresh doesn't duplicate it. The client normalizes `\n`→`\r\n` in the seed (tmux's capture emits bare LF; xterm's default LF doesn't return the cursor column, so without CRLF every row stair-steps right and overlays its neighbors). The seed is then fed through `term.write(...)`; xterm parses the escapes and populates its buffer as if that output had happened live. The live stream continues on top. Result: on first attach, users can already scroll back through the full session history.

**Load-more**: if `historyLimit` wasn't enough (default 2 000 lines), a button re-requests with a larger limit; we remember scroll position by anchoring to the visible middle line's content hash and restore after re-seed.

**Pull-to-history gesture**: **removed.** It served the old HistoryLayer model; under this design, scrolling _is_ history. The `Ctrl/⌘+↑` shortcut is repurposed to "jump to top of scrollback."

**Stick-to-bottom**: if the user is within a 2-line tolerance of the bottom when new output arrives, we auto-scroll to the new bottom. Otherwise we leave the viewport where it is (the user is reading old output; interrupting is rude).

**Alt-screen**: when xterm's active buffer flips to alt (via its `buffer.onChange` hook), we collapse `.spacer` to a single viewport's height. Alt-screen apps don't have scrollback semantics; the spacer lies to the user if we don't collapse it. A subtle banner labels the state ("alt-screen — scrollback unavailable until you exit"). When the app exits alt-screen, spacer grows back.

**Horizontal scroll**: lines wrap at pane width; long lines do not overflow horizontally in live mode. `.scroller` has `overflow-x: hidden`.

## Alternatives considered

- **Scheme I (JS momentum):** rejected. iOS momentum curves are not publicly specified; we'd ship subtly-wrong scrolling forever. Users notice.
- **Scheme II without DOM mirror:** rejected. Scroll would work but selection would still fail—that's ADR-0003's problem, not disjoint. A partial answer makes the codebase carry two mechanisms (freeze + scroll) that can't share. Better to unify under one DOM mirror used in all three scenarios (history, freeze, scroll).
- **Scheme IV (on-touch-only mirror):** deferred. It's an optimization of scheme III. Measure the cost of always-on mirror in Phase 2; if dom reconciliation during scroll exceeds a frame budget, switch to touch-gated mirror. Until then, simplicity wins.
- **Scheme V (iframe):** dismissed.
- **Keep HistoryLayer as separate pull-down view:** rejected. Two mechanisms for "see old output" violates principle 2 (one physical surface for a concern). Scrolling is the universal gesture; we should honor it.
- **Lazy top-fill (capture more history when user scrolls to top):** deferred to v2. Adds prepend-to-scrollback complexity xterm doesn't natively support; eager seeding is simpler and 2 000 lines is enough for v1.

## Consequences

Easier:

- Scrolling feels like the rest of the OS. The biggest complaint about tmux-mobile goes away.
- One DOM-mirror rendering path now powers three features (freeze, selection, scroll). Refactors are cheap because there's only one code path.
- HistoryLayer and the pull-down gesture are dropped—less code, less conceptual surface.
- Attach becomes a single "seed + stream" motion; history is immediately available without a second round-trip.

Harder:

- Font metric coupling across canvas and DOM becomes load-bearing for three features. Any drift breaks all of them. `styles/tokens.css` is now a high-scrutiny file.
- Scroll event → xterm render → DOM reconciliation has a frame budget of ~12 ms to feel smooth. Implementation must:
  - rAF-throttle scroll → render calls
  - row-diff the DOM mirror (patch only changed lines, not innerHTML replace)
  - keep the mirror to the visible window + a small buffer (don't render 10 000 lines as DOM—the canvas's scrollback is in xterm, the mirror only shows what the user can see)
- Attach latency grows by one `capture-pane` round-trip (~50–300 ms depending on pane size and network). Still well inside acceptable.
- Alt-screen detection must react within one frame of the buffer switch or the spacer lies. xterm emits an event; we use it.
- `term.scrollToLine` must be benign when called at 60 Hz—it is (O(1) pointer move inside the buffer), but we verify under load.
- Stick-to-bottom detection must distinguish "user scrolled away" from "programmatic scroll we just performed." We set a `suppressUserDetection` flag around our own `scrollTo()` calls.

Locked:

- The virtual scroll container architecture is now the single way to display live terminal content. Any alternative (plain xterm with no container) would be a regression.
- The xterm scrollback limit becomes a product decision, not an xterm default. Initial: 10 000 lines. Configurable later via settings.

## Implementation notes

**Font metrics.**

- Use `Intl.Segmenter` or `xterm.buffer.active.getLine(y).getCell(x).isWideChar()` to decide cell width; wide cells get `display: inline-block; width: 2ch` (or `calc(var(--cellW) * 2)` if `ch` proves inconsistent across Safari/Chrome under Nerd Font).
- Freeze the font stack to a single Nerd Font loaded from the app bundle. System-dependent fallback is too risky at this alignment tolerance.
- `line-height` is set in px, not unitless, so rounding matches canvas.

**Scroll → xterm sync.**

```
const onScroll = () => {
  if (rafPending) return;
  rafPending = requestAnimationFrame(() => {
    rafPending = false;
    const topLine = Math.floor(scroller.scrollTop / cellHeight);
    if (topLine !== lastTopLine) {
      term.scrollToLine(topLine);   // O(1)
      renderMirror(topLine, visibleRowCount);
      lastTopLine = topLine;
    }
  });
};
```

**DOM mirror update.**

- On each scroll-tick _and_ on each `term.onRender`, read `term.buffer.active` for the visible window.
- Diff against the previous rendered rows; patch only changed rows.
- Wide-char cells wrap inside `<span class="w">`; normal cells are plain spans with style classes per SGR run (e.g., `c-red b-bold`).
- Style classes are generated once into a stylesheet at boot; inline styles are avoided for perf and GC.

**Stick-to-bottom.**

```
const isAtBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < cellHeight * 2;
term.onData(() => { if (wasAtBottom) scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'auto' }); });
```

**Alt-screen.**

```
term.buffer.onBufferChange((buf) => {
  if (buf.type === 'alternate') spacerHeight = viewportHeight;
  else spacerHeight = term.buffer.active.length * cellHeight;
});
```

**History seed.**

- On attach: `await control.request({ type: 'capture_scrollback', lines: 10000, includeEscapes: true })`.
- `term.write(response.text)` synchronously; then subscribe to live stream.
- Set initial `scroller.scrollTop = scroller.scrollHeight` so user sees latest (live) content.

**Test matrix** (all Phase 2 work):

- iOS Safari 16, 17, 18 (iPhone SE small, Pro Max large)
- Android Chrome on low-end (4 GB RAM)
- Desktop Chrome, Firefox, Safari—verify wheel scroll and mouse drag selection still behave
- dom / canvas / webgl xterm renderers (option flag in settings); the mirror must align for all three

## Open questions deferred

- **Q1**: Whether to expose a settings toggle for "native scroll vs. pull-down history" as a compatibility fallback. Probably no; ship the better one.
- **Q2**: Content-hash anchoring during load-more may be fragile if two identical lines appear. Consider using position + a short suffix fingerprint.
- **Q3**: If the mirror becomes a perf problem on low-end Android, reassess scheme IV (touch-gated mirror).
