# 0005. Headless xterm.js as parser; React-owned DOM as the only renderer

- Status: accepted
- Date: 2026-04-19
- Deciders: @ChuangLee
- Supersedes: the "DOM mirror over xterm's canvas/DOM" framing in ADR-0004. Collapses the `FreezeLayer` mechanism of ADR-0003 into a trivial "pause updates" flag.

## Context

Phase 2 shipped with three overlapping mechanisms for displaying terminal content:

- **xterm.js's own DOM renderer** (xterm 6 removed canvas; DOM is the only built-in renderer now — see `project_xterm6_dom_renderer.md`).
- **A transparent DOM mirror** on top of xterm's DOM, to provide native text selection during scroll (ADR-0004) and freeze (ADR-0003).
- **Our virtual scroll container** that drives xterm's viewport via `term.scrollToLine(n)` while scroll events happen natively on `.tm-scroller` (ADR-0004).

This stack pays two taxes:

1. **Two DOM trees must stay pixel-aligned.** xterm's renderer and our mirror render the same visible rows from the same buffer through two different code paths. Any drift in font metrics, line-height, padding, or wide-char handling breaks selection, cursor alignment, or QR codes. `styles/tokens.css` is the single source that both trees must obey exactly — one high-scrutiny file for three features.
2. **Every rendering bug has two possible origins.** The Phase 2 "stair-stepping / duplicate visible pane / empty scroll-top" triple-bug was debuggable because we built `scripts/debug-*.mjs`, but the fundamental friction is that the mirror and xterm's renderer can be in different wrong states.

Two project-specific facts make the stack easier to collapse than in a typical xterm.js embedding (see `project_input_paths.md`):

- **No mouse tracking forwarded.** This is a touch-first mobile client. The web UI has a sidebar for window/session navigation; xterm's mouse-event encoding is dead code in our deployment.
- **No direct keyboard input to xterm.** All text input goes through the compose bar, which uses a browser-native `<input>` / `<textarea>` and handles IME composition natively. xterm's hidden textarea focus-bridge is unused.

What these two facts buy us: **xterm.js does not need to touch the DOM at all.** It can run as a pure parser and state machine.

## Decision

**xterm.js runs headless** — `new Terminal({ ... })` is constructed, fed PTY bytes via `term.write()`, and queried via `term.buffer.active.getLine(y).getCell(x)`. We **do not call `term.open(el)`**. xterm owns no DOM, renders nothing, handles no keyboard, decodes no mouse.

**A React component tree owns the visible DOM**, driven off xterm's buffer:

```
Surface
└── .tm-scroller     (overflow-y: auto; touch-action: pan-y; native scroll)
    ├── .tm-viewport (position: sticky; top: 0; height: 100%)
    │   └── .tm-rows (window of <Row> for the currently-visible lines)
    └── .tm-spacer   (height = (bufferLength − rows) × cellHeight)
```

The `.tm-viewport` — `.tm-spacer` DOM order from ADR-0004 is retained (see `feedback_sticky_viewport_dom_order.md`). The mirror (`.tm-mirror`) is deleted. xterm's own DOM (`.xterm.xterm-dom-renderer-owner-N`) no longer exists because we never call `term.open()`.

**Subscription model** (verified by spike; `onRender` does NOT fire without `term.open()`, so we use other hooks):

| Event                             | Purpose                                                |
| --------------------------------- | ------------------------------------------------------ |
| `term.onWriteParsed`              | every chunk parsed → schedule React re-render          |
| `term.onScroll`                   | buffer gained a scrollback line → update spacer height |
| `term.buffer.onBufferChange`      | alt-screen switch → collapse spacer, switch buffer     |
| `term.onCursorMove`               | cursor position changed → update cursor `<span>`       |
| native `scroll` on `.tm-scroller` | user scrolled → compute visible row window             |

All of these coalesce into a single `requestAnimationFrame`-throttled update that recomputes the visible window and patches only the rows that changed.

**Row rendering** (the `<Row>` component):

- For each visible `y` in `[topLine, topLine + rows)`:
  - `line = buffer.active.getLine(y)`; fall back to an empty row if `undefined`.
  - Walk cells left-to-right, coalescing consecutive cells with identical SGR attributes into a single `<span>` for efficiency (same idea as xterm's DOM renderer).
  - Cell width = 1 → `<span class="sgr-<hash>">char</span>`; width = 2 → wrap in `<span class="w">` with `display: inline-block; width: calc(var(--cellW) * 2)`; width = 0 → emit nothing (the trail cell of a wide char).
  - SGR classes are generated at boot into a single `<style>` block keyed by `(fgMode, fgColor, bgMode, bgColor, boldItalicUnderlineInverseDimBlinkInvisibleStrikethroughOverline)`. Inline styles are avoided to keep GC pressure predictable under heavy redraws.
  - Palette colors (0–15) map to `--c-0` … `--c-15` CSS custom properties defined in `tokens.css`; 16–255 map to the xterm 256 palette baked into a generated stylesheet; RGB colors inline `color: #RRGGBB` (the only inline style we allow — pre-hashing 16M classes is silly).

**Cursor** is a `<span class="cursor">` positioned absolutely at `(buffer.cursorX × cellW, (buffer.cursorY − topLine) × cellH)` within `.tm-viewport`. Blink is CSS. Hidden when `term.buffer.active` reports cursor as hidden via the parser (we read `term.options.cursorStyle` and the `DECTCEM` state via `term.modes`).

**Selection** is native. Every row is real DOM text with `user-select: text`. Long-press on iOS/Android, mouse drag on desktop. The browser paints the highlight. No FreezeLayer, no mirror. If we ever need "freeze while selecting", it's a single boolean `pauseUpdates` that stops the rAF tick — the DOM is frozen because no one is patching it.

**Scroll** is native, as in ADR-0004. We do NOT call `term.scrollToLine()` any more — that was only needed to keep xterm's own renderer in sync. We compute `topLine` from `scrollTop / cellHeight` and render directly. `buffer.active.length` gives us the total line count for the spacer.

**Alt-screen** collapses the spacer to `0px` (`.tm-rows` becomes the full viewport; `buffer.active` is the alternate buffer; length is `rows` exactly). A subtle banner labels the state. When the app exits alt-screen, we re-read `buffer.normal.length` and grow the spacer back.

**Stick-to-bottom** works the same way as before: if scrollTop was within a tolerance of scrollHeight at the moment new bytes arrive, we set `scrollTop = scrollHeight` after the rAF tick completes.

**Input**: unchanged. The compose bar sends strings to the backend over the WebSocket; the PTY echoes them back as output; xterm parses them; we render. There is no keyboard path that involves xterm's DOM.

**Mouse**: not forwarded. No DECSET 1000/1002/1003/1006 encoding. If an app enables mouse mode, tmux gets no clicks — acceptable because mouse in terminal apps is never something a phone user enables, and desktop users don't need it either (the web UI's own affordances cover session/pane switching).

## Alternatives considered

- **Keep the mirror; fix bugs case-by-case.** Rejected. Two code paths rendering the same cells is a structural cost — we'll pay it forever unless we collapse the duplication. Every future regression will recreate the alignment problem.
- **Render with a different parser (ansi-to-html, anser, custom).** Rejected. ANSI has 10+ years of edge cases in xterm — DECSET modes, OSC 8 hyperlinks, bracketed paste, alt-charset, REP, DCS passthrough, SIXEL (when we eventually want it). Throwing the parser away means reimplementing the state machine. Keep the parser; swap the renderer.
- **Use `@xterm/addon-webgl` for perf.** Rejected for v1. Visible rows are ~30–80. React with coalesced SGR spans is fast enough. WebGL is a different solution to a problem we don't have; it would also re-introduce the "can't select canvas" problem we're trying to escape.
- **Adopt Million.js / block VDOM.** Rejected. Million.js pays off at thousands of diffed nodes. Our window is tens of rows. React 19's reconciler + row-level `memo` is sufficient, and Million.js introduces a build-time transform that limits future flexibility. If profiling proves otherwise in Phase 3+, revisit — but do not pre-optimize.
- **Defer the pivot until Phase 3 polish.** Rejected. Deferring means shipping more features on top of a stack we know is wrong; every feature added to the mirror path is code that must be reworked. Do the pivot now, while the codebase is still small.

## Consequences

**Easier:**

- One DOM tree. One renderer. One source of truth for what's on screen. The entire "two trees must align" tax goes to zero.
- Native selection just works — no freeze gesture, no mirror pointer-events gymnastics. ADR-0003 collapses from "long-press → render into FreezeLayer → pointer-events dance" to "the DOM is always selectable because it's always real text."
- Font metrics matter less. The mirror had to match xterm's canvas (now DOM) glyph positions exactly; now the glyphs are wherever our `<span>` renders them — as long as `line-height` and `letter-spacing` are stable across browsers, we're done.
- Debugging becomes cheaper. Diagnostic scripts can inspect a single DOM tree; the old "xterm rows vs mirror rows" mismatch check is retired — there's nothing to mismatch.
- The QR code case works the same or better: half-block Unicode chars render in our `<span>` at cellW×cellH with no kerning (monospace font, `letter-spacing: 0`, `line-height` in px). We add a Playwright+jsqr test to keep this honest.
- ADR-0004's "mirror is above the canvas" framing disappears. The virtual scroll container itself (the good part of ADR-0004) stays unchanged.

**Harder:**

- **We now own the cursor.** xterm rendered a blinking cursor for free; we render our own `<span class="cursor">` with CSS animation. Alt-screen apps (vim, Claude Code full-screen) manipulate the cursor intensely — we re-read position on every `onCursorMove`.
- **We now own color mapping.** A stylesheet of ~(16 palette × 16 palette × 4 style flags ≈ 1024) classes is generated at boot. 256-palette and RGB colors are generated on demand (RGB uses inline `color:`). First render without cached classes may stutter on a huge diff; we prewarm the common 16×16 set at boot.
- **We now own wide-char width.** `buffer.active.getLine(y).getCell(x).getWidth()` is the source of truth (spike-verified: CJK → 2, trail cell → 0). Wide `<span class="w">` sets `display: inline-block; width: calc(var(--cellW) * 2)`; trail cells emit no DOM. Emoji are handled the same as CJK.
- **We now own scroll → render throttling.** rAF ticks on every subscribed event; if a tick is already scheduled, we skip. Target: render at ≤1 frame (~16 ms) for a visible window of 40 rows.
- **We lose `term.onRender`.** Not a real loss — `onWriteParsed` + `onScroll` + `onBufferChange` cover the same information at higher fidelity. Verified by spike.
- **Alt-screen apps may set cursor shape / visibility via DECSET modes.** xterm tracks these in `term.modes.cursorBlink`, `term.modes.cursorStyle`, plus DECTCEM for visibility. We re-read on every tick.
- **OSC 8 hyperlinks** — supported by xterm's parser; each cell's hyperlink is accessible via `cell.getHyperlink?.()` (may need `allowProposedApi: true`). Deferred to Phase 3 — render cells as plain spans for v1, wrap in `<a>` later.
- **Reflow on resize** — `term.resize(cols, rows)` works without `open()` (spike-verified). We drive it from `ResizeObserver` on `.tm-scroller` exactly as before; our row renderer reads the new `buffer.active` after reflow.

**Locked:**

- The project's render architecture is now "xterm as headless parser + our DOM as the only tree." Introducing a second renderer (WebGL, canvas, offscreen) would be a regression and requires a new ADR.
- The `.tm-mirror` class no longer exists. Any code or test referencing it is either dead or referencing the new `.tm-row` structure.

## Implementation notes

**Boot sequence:**

```ts
// 1. Generate SGR class stylesheet (runs once at app start).
generateSGRStylesheet({ commonFg: 16, commonBg: 16, flagBits: 10 }).inject();

// 2. Create headless xterm.
const term = new Terminal({
  cols,
  rows,
  scrollback: 10000,
  allowProposedApi: true
  // convertEol: default (false). CRLF normalization happens at seed time,
  // per feedback_capture_pane_crlf.md.
});
// NOTE: no term.open(el).

// 3. Wire subscriptions into a single rAF update.
const scheduleRender = useRaf();
term.onWriteParsed(scheduleRender);
term.onScroll(scheduleRender);
term.onCursorMove(scheduleRender);
term.buffer.onBufferChange(() => {
  altScreen = term.buffer.active.type === "alternate";
  scheduleRender();
});

// 4. Feed the seed (CRLF-normalized) + live stream.
term.write(crlfNormalize(seed));
socket.on("data", (b) => term.write(b));
```

**Row component:**

```tsx
const Row = memo(({ bufLine, y, cols }) => {
  const runs = coalesceRuns(bufLine, cols); // array of { text, classes, isWide }
  return (
    <div className="tm-row" data-y={y}>
      {runs.map((r, i) =>
        r.isWide ? (
          <span key={i} className={`w ${r.classes}`}>
            {r.text}
          </span>
        ) : (
          <span key={i} className={r.classes}>
            {r.text}
          </span>
        )
      )}
    </div>
  );
});
```

**Scroll → visible window:**

```ts
const topLine = Math.floor(scroller.scrollTop / cellHeight);
const endLine = Math.min(buffer.active.length, topLine + term.rows + overscan);
// Render rows [topLine, endLine). React-virtual handles the DOM windowing.
```

**SGR class generator (sketch):**

```ts
function sgrClass(cell: IBufferCell): string {
  const parts: string[] = [];
  if (!cell.isFgDefault()) {
    if (cell.isFgRGB()) parts.push(`fg-rgb-${cell.getFgColor().toString(16)}`);
    else parts.push(`fg-${cell.getFgColor()}`);
  }
  if (!cell.isBgDefault()) {
    if (cell.isBgRGB()) parts.push(`bg-rgb-${cell.getBgColor().toString(16)}`);
    else parts.push(`bg-${cell.getBgColor()}`);
  }
  if (cell.isBold()) parts.push("b");
  if (cell.isItalic()) parts.push("i");
  if (cell.isUnderline()) parts.push("u");
  if (cell.isInverse()) parts.push("inv");
  // etc.
  return parts.join(" ");
}
```

**Delete list** (what we remove from Phase 2):

- `src/frontend/features/terminal/mirror.ts` (or wherever the mirror renderer lives) and its tests.
- `.tm-mirror` CSS + any `.tm-mirror` references in `Surface.tsx`.
- FreezeLayer render path — the freeze state becomes a boolean that stops subscribing to `onWriteParsed` for the duration of a long-press.
- Any `term.open(element)` call. Search: `grep -rn "term.open\|\.open(" src/frontend/features/terminal/`.
- Any mirror-row diagnostic should count `.tm-row` instead.

**Test additions:**

- Unit: SGR class coalescing, wide-char handling (1/2/0), palette vs RGB, empty line.
- Integration: headless xterm in jest/vitest (may need to stub `requestAnimationFrame`).
- E2E (Playwright): arrow-key selection works, long-press selection on mobile, alt-screen spacer collapse, scroll-to-top shows oldest buffer line, QR code renders + decodes via `jsqr` (asserts font metrics are pixel-stable).
- Regression: Claude Code arrow menu repaints correctly as the user presses up/down.

**Rollback plan:** if the pivot hits a deal-breaker (unlikely based on the spike but possible), reverting is a single-commit restore — the entire pivot should land in one cohesive commit on a `refactor/dom-renderer` branch, with the old mirror files preserved via git history, not kept in the tree as dead code.

## Open questions deferred

- **Q1**: OSC 8 hyperlinks — add when a real use case shows up. Likely Phase 3 or 4.
- **Q2**: Image protocols (SIXEL, iTerm, Kitty) — same policy as pre-pivot: not supported; not a regression.
- **Q3**: Blink / dim attributes — CSS animation and opacity, respectively. Ship with accessible `prefers-reduced-motion` guard.
- **Q4**: Whether `react-virtual` is the right windowing library vs. a plain sliced array (windowLength is small; `react-virtual` may be overkill). Start with react-virtual; downgrade to plain slicing if bundle/complexity cost outweighs benefit.
