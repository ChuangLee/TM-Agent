# Mobile action-first UI — prototype mocks

ASCII mocks and interaction notes supporting [ADR-0006](../adr/0006-mobile-action-first-ui.md). Not production code — visual intent pinned before build.

Each mock targets iPhone 13 Pro portrait (~390×844 CSS px). Width of ASCII canvas is ~40 chars as a stand-in; relative proportions are what matters.

## Legend

- `░` semi-transparent background (~78% opacity)
- `█` / `┌─┐`, `└─┘` opaque key or card face
- `▁` cursor
- `◉` / `⌃` top-bar affordances
- `[xxx]` tappable card
- `⌨` open key overlay
- `✎` open compose bar

## Layout regions (all states)

```
┌──────────────────────────────────────┐
│ top bar                              │  ~6vh — connection dot, session name, menu
├──────────────────────────────────────┤
│                                      │
│ terminal surface                     │  ~55–60vh
│                                      │
├──────────────────────────────────────┤
│ context card strip                   │  ~16vh — 1–2 rows of cards, horizontal scroll
├──────────────────────────────────────┤
│ action rail                          │  ~10vh — always [⌨] [✎] + state-essential keys
└──────────────────────────────────────┘
```

The split is fluid: `confirm_prompt` and `password_prompt` expand the card strip region into a prominent modal-like banner because the user's attention should be there.

---

## State 1 — `shell_idle`

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · zsh           ⌃ │
├──────────────────────────────────────┤
│ $ ls                                 │
│ README.md  package.json  src/  docs/ │
│ $ cd src/frontend                    │
│ $ git status                         │
│ On branch main                       │
│ nothing to commit, working tree clean│
│ $ ▁                                  │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ frequent   ◂ scroll ▸                │
│ [ls]  [git st]  [npm run dev]        │
│ [clear]  [cd ..]  [git diff]         │
├──────────────────────────────────────┤
│  [↑ hist]  [ Tab ]  [ ⌨ ]  [ ✎ ]    │
└──────────────────────────────────────┘
```

**Cards:** frequent commands learned from `~/.bash_history` + user-pinned. Tap = send `<text>\n`. Long-press = copy into compose for edit-then-send.

**Top-right `⌃` menu:** pin / unpin current card, edit pinned list, open command palette.

---

## State 2 — `long_process`

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · npm            ⌃ │
├──────────────────────────────────────┤
│ $ npm run dev                        │
│ vite v7.1.9                          │
│ ready in 124 ms                      │
│                                      │
│ ➜ Local:   http://localhost:5173/    │
│ ➜ press h to show help               │
│ ▁                                    │
│                                      │
├──────────────────────────────────────┤
│                                      │
│      ┌─────────────────────┐         │
│      │   ⏹  Ctrl+C         │         │
│      │   stop the process  │         │
│      └─────────────────────┘         │
│                                      │
├──────────────────────────────────────┤
│  [ h ]  [ q ]  [ ⌨ ]  [ ✎ ]         │
└──────────────────────────────────────┘
```

**Detection:** non-alt, continuous output within 3s, no prompt in tail.

**Extra cards:** if the process advertises single-letter shortcuts in recent output (e.g. Vite's "press h to show help"), we lift them into the action rail. Heuristic: regex match `press ([a-z]) to ([^.]+)` in the last 30 lines.

---

## State 3 — `editor` (vim)

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · vim notes.md  ⌃ │
├──────────────────────────────────────┤
│ # Notes                              │
│                                      │
│ - buy milk▁                          │
│ - walk dog                           │
│ - call mom                           │
│                                      │
│ ~                                    │
│ ~                                    │
│ ~                                    │
│ "notes.md" 5L, 42C               3,8 │
├──────────────────────────────────────┤
│ [:w]  [:q]  [:wq]  [i]  [Esc]  [/]   │
│ [gg]  [G]  [dd]  [yy]  [p]           │
├──────────────────────────────────────┤
│ [↑] [↓] [←] [→]  [ ⌨ ]  [ ✎ ]        │
└──────────────────────────────────────┘
```

**Detection:** alt-screen + cmd ∈ {vim, nvim, nano, micro, hx}.

**Cards:** modal-aware set. `nano` swaps `[:w] [:q] [:wq]` for `[^O] [^X] [^K]` (its prefix convention), same visual slot.

**Arrows in action rail:** permanent in `editor` state — modal editor navigation needs them constantly.

---

## State 4 — `tui` (Claude Code full-screen)

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · claude        ⌃ │
├──────────────────────────────────────┤
│ ┌─ Claude ─────────────────────────┐ │
│ │                                  │ │
│ │  > tell me a joke                │ │
│ │                                  │ │
│ │  Here's one:                     │ │
│ │  Why don't scientists trust      │ │
│ │  atoms? Because they make up     │ │
│ │  everything. ▁                   │ │
│ │                                  │ │
│ │  [Type message…]                 │ │
│ └──────────────────────────────────┘ │
├──────────────────────────────────────┤
│ [y] [n] [Esc] [/] [?]                │
│ [Enter] [Ctrl+C]                     │
├──────────────────────────────────────┤
│ [↑] [↓] [←] [→]  [ ⌨ ]  [ ✎ ]        │
└──────────────────────────────────────┘
```

**Detection:** alt-screen + cmd ∈ {claude, aider, htop, btop, lazygit, ranger, fzf, k9s}; unknown alt-screen commands fall here as well (`confidence: low`).

**Cards:** Y/N/Esc cover "claude is asking for permission"; `/` + `?` cover command-palette / help patterns most TUIs share.

---

## State 5 — `repl` (node)

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · node          ⌃ │
├──────────────────────────────────────┤
│ Welcome to Node.js v20.10.0.         │
│ Type ".help" for more information.   │
│ > const x = 10                       │
│ undefined                            │
│ > x * 2                              │
│ 20                                   │
│ > ▁                                  │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ [.exit]  [.help]  [.clear]           │
│ [const]  [let]  [function]           │
├──────────────────────────────────────┤
│  [↑ hist]  [ Tab ]  [ ⌨ ]  [ ✎ ]    │
└──────────────────────────────────────┘
```

**Detection:** cmd ∈ {python, node, bun, irb, ghci} or tail matches `^(>>> | \.\.\. | > | In \[\d+\])`.

**Cards:** language-specific secondary keywords. Python swaps `[const] [let] [function]` for `[import] [def] [class]`.

---

## State 6 — `pager` (less, man)

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · less          ⌃ │
├──────────────────────────────────────┤
│ NAME                                 │
│        ls - list directory contents  │
│                                      │
│ SYNOPSIS                             │
│        ls [OPTION]... [FILE]...      │
│                                      │
│ DESCRIPTION                          │
│        List information about the    │
│        FILEs (the current directory  │
│        by default). ...              │
│ :▁                                   │
├──────────────────────────────────────┤
│ [Space] [b] [/] [n] [q]              │
│ [G] [gg] [?]                         │
├──────────────────────────────────────┤
│ [↑] [↓]  [ ⌨ ]  [ ✎ ]                │
└──────────────────────────────────────┘
```

**Detection:** alt-screen + cmd ∈ {less, more, man}.

---

## State 7 — `confirm_prompt`

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · apt           ⌃ │
├──────────────────────────────────────┤
│ The following will be installed:     │
│   libfoo  libbar  libbaz             │
│ After this operation, 42 MB used.    │
│ Do you want to continue? [Y/n] ▁     │
│                                      │
├──────────────────────────────────────┤
│ ╭──────── Script is waiting ────────╮│
│ │                                   ││
│ │  ┌──────────┐    ┌──────────┐     ││
│ │  │   Yes    │    │    No    │     ││
│ │  └──────────┘    └──────────┘     ││
│ │                                   ││
│ │   default: Yes  (press Enter)     ││
│ ╰───────────────────────────────────╯│
├──────────────────────────────────────┤
│  [ ⌨ ]  [ ✎ ]                        │
└──────────────────────────────────────┘
```

**Detection:** tail matches `\[[yY]/[nN]\]` or `\(yes/no\)` or `continue\?`.

**Behavior:**
- The capitalized option (`Y` in `[Y/n]`) is visually highlighted — that's the scripted default.
- Tap `Yes` → sends `y\n`. Tap `No` → sends `n\n`.
- If the prompt scrolls off before the user answers, banner stays pinned and the underlying terminal keeps updating underneath.
- Enter on compose bar sends the default without opening the keyboard overlay.

---

## State 8 — `password_prompt`

```
┌──────────────────────────────────────┐
│ ◉ sessions   main · sudo          ⌃ │
├──────────────────────────────────────┤
│ $ sudo systemctl restart nginx       │
│ [sudo] password for user: ▁          │
│                                      │
│                                      │
├──────────────────────────────────────┤
│ ╭──────── Enter password ───────────╮│
│ │                                   ││
│ │  ┌───────────────────────────┐    ││
│ │  │ •••••••▁                  │    ││
│ │  └───────────────────────────┘    ││
│ │  [👁 show]  [🗙 cancel]  [send →] ││
│ │                                   ││
│ ╰───────────────────────────────────╯│
├──────────────────────────────────────┤
│                                      │
└──────────────────────────────────────┘
```

**Detection:** tail matches `(?i)(password|passphrase).*:\s*$`.

**Security:**
- Native `<input type="password">`. Bytes streamed char-by-char to PTY on `send`.
- **Never** echoed to compose history, draft stash, or the state banner.
- Cancel → sends `Ctrl+C`.
- Banner auto-dismisses when tail no longer matches the password pattern.

---

## Top-drop key overlay

Invoked via `⌨` or a 60px downward drag from the top edge. Slides down from the top. Covers ~68vh. Semi-transparent background so the bottom ~32vh of live shell remains visible.

```
░░░░░░░░░ pull handle ░░░░░░░░░░░░░░░░░  (~5vh, ═══ handle hint)
░                                       ░
░  state-contextual keys                 ░  (smaller, upper)
░  [:w]  [:q]  [:wq]  [gg]  [G]  [/]     ░
░                                        ░
░  ── modifiers ──                       ░
░  [Ctrl]   [Alt]   [Shift]   [Fn]       ░
░                                        ░
░  ── navigation ──                      ░
░              ┌───┐                     ░
░              │ ↑ │                     ░
░        ┌───┐ └───┘ ┌───┐                ░
░        │ ← │       │ → │                ░
░        └───┘ ┌───┐ └───┘                ░
░              │ ↓ │                     ░
░              └───┘                     ░
░                                        ░
░  ── high frequency (thumb reach) ──    ░  (larger, bottom of overlay)
░  ┌────┐  ┌────┐  ┌────┐  ┌────┐         ░
░  │ Esc│  │ Tab│  │ ↵  │  │ ⌫  │         ░
░  └────┘  └────┘  └────┘  └────┘         ░
░                                        ░
░  ┌────┐  ┌────┐  ┌────┐  ┌────┐         ░
░  │ |  │  │ ~  │  │ /  │  │ \  │         ░
░  └────┘  └────┘  └────┘  └────┘         ░
░                                        ░
░                         [✎ compose]    ░  (dismisses overlay, opens compose)
├────────────────────────────────────────┤
│ $ vim notes.md                         │
│ # Notes                                │  ← visible shell tail (~32vh, full opacity)
│ - buy milk▁                            │
│ ...                                    │
└────────────────────────────────────────┘
```

**Interaction:**

- **Open:** tap `⌨` card, or drag down from the top edge of the viewport (threshold: 60px over 300ms).
- **Close:** tap inside the bottom-32vh shell area (tap passes through), upward swipe anywhere on the overlay, or tap `✎` to transition to compose mode.
- **Sticky modifiers:** tap `Ctrl` → amber outline → next key sends combo, modifier auto-releases. Long-press locks; second long-press unlocks. Visual state persists until released.
- **Contextual keys band:** content driven by current `ShellState` — same vocabulary as the context card strip but larger tap targets.
- **Animation:** 180ms `translateY(-100% → 0)` + `opacity 0 → 1`. Under `prefers-reduced-motion` the overlay snaps into place without transform.

**Spatial logic:**

- Drops from top to visually distinguish from the system IME (which rises from bottom).
- Leaves bottom of screen — the high-activity zone in every terminal — free.
- Internal priority is **inverted** (high-frequency at the overlay's bottom edge, not top): thumb reach dominates even though the overlay descends from above.

---

## Compose bar + prompt capture banner

When the user opens compose mode (`✎`) and the state is `confirm_prompt` or `password_prompt`, a capture banner sits above the compose bar:

```
┌──────────────────────────────────────┐
│ [shell output above]                 │
├──────────────────────────────────────┤
│ ▎ Script is waiting: [Y/n]           │
│ ▎   [ Yes ]   [ No ]   (× dismiss)   │
├──────────────────────────────────────┤
│ ╭─────────────────────────────╮  [→] │
│ │ git commit -m "fix: …        │      │
│ ╰─────────────────────────────╯      │
├──────────────────────────────────────┤
│  [↑ hist]  [ ⌨ ]                     │
└──────────────────────────────────────┘
```

**Behavior:**

- Banner appears automatically when state becomes `confirm_prompt` / `password_prompt` and user is in compose mode. Also shown in the non-compose default view (see State 7 / 8 mocks); they are the same component, different container.
- `× dismiss` hides this instance; a new matching prompt re-shows it.
- Long-press compose bar → quick-insert tray (deferred; see Q below).

---

## Detection pipeline

```
┌─────────────────┐
│ xterm buffer    │ ── tail (last 5 rows) ──┐
│ (onWriteParsed) │                         │
└─────────────────┘                         │
                                            ▼
┌─────────────────┐                ┌────────────────┐        ┌──────────┐
│ tmux control:   │ ── cmd ──────▶ │   classifier   │ ─────▶ │ UI store │
│ pane_current_   │                │ (pure, 200ms   │        └──────────┘
│ command         │                │   debounce)    │              │
└─────────────────┘                └────────────────┘              ▼
                                            ▲              ┌──────────────┐
┌─────────────────┐                         │              │ ActionPanel  │
│ altScreen flag  │ ── altScreen ───────────┘              │ KeyOverlay   │
│ (onBufferChange)│                                        │ ComposeBar   │
└─────────────────┘                                        └──────────────┘
```

See ADR-0006 §1 for the classifier's detection rules.

---

## Unknown-state fallback

If no state matches with confidence: fall back to `shell_idle` layout, surface `⌨` prominently, and show a small `?` badge next to the session name in the top bar. User can always escape to raw keys via the overlay.

---

## Open interaction questions

- [ ] **Card learning:** v1 pulls from `~/.bash_history` opportunistically; user can pin/unpin. Per-shell `HISTFILE` detection is v2.
- [ ] **History filtering per state:** `editor` arrow-up shows only `:`-prefixed commands; `repl` shows only REPL inputs. Needs a tagged history structure.
- [ ] **Multi-pane:** action panel follows focused pane. Switching pane re-runs the classifier with the new pane's signals.
- [ ] **Accessibility:** overlay focus trap + arrow-key navigation between keys (tablet landscape is plausible where a BT keyboard attaches).
- [ ] **Quick-insert tray:** URL / path / branch extraction regexes; probably fine to ship in v1.1.
- [ ] **Desktop symmetry:** the overlay could double as a Ctrl-/ palette on desktop. Out of scope for this prototype; tracked in ROADMAP Post-v1 #8.

---

## Status

Static mock only. No code produced. Next step per ADR-0006: classifier spike + single-state (shell_idle) action panel, with existing compose bar kept as baseline behind a debug flag.
