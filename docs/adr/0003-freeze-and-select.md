# 0003. Freeze-and-select for live-terminal text copying

- Status: accepted
- Date: 2026-04-19
- Deciders: @ChuangLee
- Related: design principle 5 (LiveLayer vs DOM mirrors)

## Context

Users need to copy text from the live terminal on mobile. Three facts make this harder than on desktop:

1. xterm.js renders to canvas (or webgl, or DOM-but-still-xterm-managed). The OS cannot attach selection handles to canvas pixels. Even with xterm's DOM renderer, xterm's own event handling pre-empts native long-press.
2. The live frame is a moving target. Selecting text that will scroll in the next second is a bad experience even if the mechanics worked.
3. Retrieving scrollback over the WebSocket takes a round-trip; users pressing "copy" expect instant response.

We considered three directions:

1. **Make xterm itself selectable on mobile.** Either fork xterm, or build a transparent DOM overlay that always mirrors xterm live.
2. **Force users into the pull-down history flow for any selection.** Simple, but fails the "I want _that line_ right now" case—the thing scrolled, the history capture costs a round-trip, and the user has to navigate.
3. **Freeze the screen on demand, then let native selection work on a local DOM snapshot.**

## Decision

We adopt option 3: **Freeze + Select.**

- On **long-press** (≥ 500 ms, < 10 px drift) anywhere on the live terminal surface, we:
  1. Read the current xterm buffer in-memory via `term.buffer.active.getLine(y)`—no server call.
  2. Render that buffer through our shared ANSI→HTML renderer into a new `FreezeLayer` DOM mirror, pixel-aligned to the xterm grid using the same font stack.
  3. Overlay FreezeLayer on top of LiveLayer; enable `pointer-events: auto` and `user-select: text` on it.
  4. Use `caretPositionFromPoint` (or `caretRangeFromPoint` on WebKit) to find the DOM node under the touch point.
  5. `Selection.setBaseAndExtent` over the word at that position, so the user's first visible state is "a word is already selected where I pressed."
- A **Freeze button** in the top bar does steps 2–3 without step 4/5 (no pre-selection).
- After 80 ms, if the browser did not surface native selection handles (iOS is unreliable here), we show a small floating menu anchored to the selection: `[Copy] [Select line] [Exit]`.
- PTY bytes keep flowing to xterm in the background. Exiting freeze returns the user to the latest live frame with no gaps.
- Top bar shows an unmistakable `⏸ frozen — tap to return` state; tap outside the selection or the indicator exits.

## Alternatives considered

- **xterm DOM renderer + custom long-press handling.** Rejected. Performance penalty is real (every cell is a DOM node, scrolling is visibly worse). xterm still owns the touch event stream; making long-press work reliably requires patching xterm. Cost outweighs benefit versus a fresh DOM mirror that we fully control.
- **Always-on transparent DOM mirror over xterm.** Rejected. Doubles the per-frame rendering cost, forces us to keep font metrics in sync every frame, and runs into iOS issues where the OS selects text from the mirror but the user's mental model says they selected the canvas below. Confusing and expensive.
- **Scrollback-only flow.** Rejected. Breaks the S3.1 user story ("I want _that line_ right now") and adds a network round-trip for every copy.
- **Ship without live-terminal copy.** Rejected. Enough users copy from live output that denying them would push them back to SSH.

## Consequences

Easier:

- The FreezeLayer reuses the same ANSI→HTML renderer as HistoryLayer; one code path, one set of fonts, one set of tests.
- Zero-latency entry to freeze mode—xterm's buffer is already in memory.
- Desktop users get a bonus: mouse `mousedown + drag` inside LiveLayer still triggers xterm's own selection (we don't intercept mouse drag).
- A11y benefit: FreezeLayer is real text, readable by screen readers for the frozen frame.

Harder:

- We must keep DOM font metrics precisely aligned with xterm's canvas rendering. Any difference in letter-spacing or line-height shows up as visibly misaligned text on freeze-in. Discipline required in `styles/tokens.css`.
- iOS programmatic selection handles are inconsistent across versions. Fallback floating menu is not optional; it has to ship together.
- Wide-character (CJK, emoji) width in DOM vs canvas must match. We use `display: inline-block; width: 2ch` for cells flagged as wide by xterm's buffer API. This is tested per-platform because Safari and Chrome have subtly different `ch` unit interpretations under some font-loading conditions.
- The feature is orthogonal to native touch scrolling on live; the scroll problem needs its own solution (see ADR-0004).

Locked:

- The shared ANSI→HTML renderer is now load-bearing for three features (History, Freeze, and the planned ScrollMirror). Refactors there are high-risk and should be ADR'd.
- The long-press gesture slot on the live surface is spoken for.

## Notes for implementers

- The long-press detector must `preventDefault` the browser's own context menu on desktop (`contextmenu` event) only when we successfully enter freeze; otherwise right-click users lose normal browser behavior.
- On iOS, programmatic selection is more likely to summon native handles when called **synchronously from a user-gesture handler**. The long-press timer fires from a user-gesture-originated touchmove loop, which usually qualifies; test before trusting.
- Expose `exitFreeze()` as a side-effect-free action so ScrollMirror (which will share a parent "overlay layer" manager) can dismiss it cleanly.
