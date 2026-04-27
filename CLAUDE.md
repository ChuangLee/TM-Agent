# Claude Code Instructions for TM-Agent

This file is read at the start of every Claude Code session in this repo. Follow it.

## Project in one paragraph

TM-Agent is a **touch-first** web client for tmux. tmux is the backend; the frontend rewrites every interaction to suit phones and tablets natively, and reflows cleanly on desktop as a two-column layout with a permanent session sidebar. It forks the backend and auth model from [tmux-mobile](https://github.com/DagsHub/tmux-mobile) and replaces the frontend. See [`docs/PRD.md`](./docs/PRD.md) for why, [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for how.

## Before you start

Read these in order. Don't skip:

1. [`docs/DESIGN_PRINCIPLES.md`](./docs/DESIGN_PRINCIPLES.md) — five first-principles rules that govern UX decisions. Most PR reviews cite these.
2. [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — module boundaries and data flow.
3. [`docs/ROADMAP.md`](./docs/ROADMAP.md) — which phase we're in.
4. Current open issues and the last 10 commits: `git log --oneline -10`.

## Tech stack (locked unless an ADR says otherwise)

- **Backend**: TypeScript, Node 20+, Express 5, `ws`, `node-pty`, Zod. Inherited from tmux-mobile.
- **Frontend**: React 19, Vite 7, TypeScript, Tailwind v4, Radix primitives via `shadcn/ui`, `motion`, `@use-gesture/react`, `@tanstack/react-virtual`, `xterm.js` for the _live_ pane only.
- **Testing**: Vitest (unit + integration), Playwright (e2e).
- **Lint/format**: ESLint + Prettier (TBD in Phase 0).

Adding a dependency requires an ADR if it's not a small utility.

## Directory layout

```
TM-Agent/
├── CLAUDE.md              ← this file
├── README.md
├── CONTRIBUTING.md        ← workflow, commit/PR conventions
├── SECURITY.md            ← threat model (inherited from tmux-mobile, re-examined)
├── package.json
├── vite.config.ts
├── tsconfig.*.json
├── src/
│   ├── backend/           ← ported from tmux-mobile, mostly unchanged
│   │   ├── auth/
│   │   ├── tmux/
│   │   ├── pty/
│   │   ├── state/
│   │   ├── cli.ts
│   │   └── server.ts
│   └── frontend/          ← NEW, touch-first shell
│       ├── app/           ← AppShell, routing (single page), theme
│       ├── features/      ← vertical slices: sessions, windows, panes, compose, history, commands
│       ├── components/    ← reusable UI primitives (shadcn-generated + custom)
│       ├── hooks/
│       ├── lib/           ← pure utilities (ANSI parsing, keybindings, clipboard)
│       ├── services/      ← WebSocket client, REST client
│       └── styles/
├── tests/
│   ├── backend/
│   └── frontend/
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   ├── DESIGN_PRINCIPLES.md
│   ├── ROADMAP.md
│   ├── adr/               ← Architecture Decision Records
│   └── prototypes/
└── .github/workflows/
```

## Commands you will use

Until Phase 0 bootstrap lands, most of these don't work yet. After that:

```bash
npm install
npm run dev          # concurrent backend + vite
npm run build        # frontend + backend
npm run typecheck    # tsc --noEmit for both projects
npm test             # vitest run
npm run test:e2e     # playwright
npm run lint
```

Pre-commit hook (via `lefthook` or `husky`) runs typecheck + lint + test:unit. Don't bypass with `--no-verify` unless the user explicitly authorizes.

## Coding conventions

### TypeScript

- `strict: true` in every tsconfig. No `any` without a comment explaining why.
- Prefer `type` over `interface` for data shapes; `interface` only when you need declaration merging.
- Shared types live in `src/{backend,frontend}/types/` and mirror the wire protocol in `src/shared/protocol.ts` (Zod schemas source of truth).

### React

- Function components only.
- Hooks: keep side effects in `useEffect`/`useLayoutEffect`, derive state in `useMemo` when non-trivial. Prefer Zustand (or a single context) over Redux for global state.
- Vertical slices live under `features/`—each feature owns its components, hooks, and local state.
- Never import from another feature's internals directly; cross-feature coupling goes through a shared `services/` or `lib/` module.

### CSS / styling

- Tailwind utility classes first. Arbitrary values (`[...]`) are fine when semantics matter more than design tokens.
- Design tokens live as CSS custom properties in `src/frontend/styles/tokens.css`. Tailwind theme references those vars.
- **No inline `style=` except for dynamic values** (transforms, computed sizes, drag offsets).
- **Media queries for layout go last in the cascade**. Do not place media queries before the base rule they override—CSS specificity is equal across `@media`, and source order decides. This bit us during the prototype.

### Naming

- Files: kebab-case (`session-picker.tsx`, not `SessionPicker.tsx`). Exports are named-export PascalCase.
- React components: PascalCase. Hooks: `useFoo`. Event handlers: `onFoo` (prop), `handleFoo` (body).
- Tmux domain terms (session, window, pane, client) map 1:1 to code names—don't paraphrase.

### Comments

- Default: write **no** comment. Good names replace them.
- Write a comment only when the _why_ is non-obvious: a constraint, invariant, workaround, or surprise.
- Do **not** explain _what_ the code does. Do not reference the current task ("added for mobile PR #42")—that belongs in git history.

## Testing discipline

Every PR that changes behavior ships tests:

- **Unit**: pure logic (parsers, reducers, keybinding resolvers).
- **Integration**: backend WebSocket + tmux gateway using `FakeTmuxGateway` and `FakePtyFactory` (patterns inherited from tmux-mobile; see `tests/backend/`).
- **E2E**: Playwright, one scenario per user story in the PRD. Tests run against a built frontend + in-memory backend.

Gesture-heavy components need special care: use `@testing-library`'s pointer events, not bare mouse events.

## Git & PR workflow

We use **GitHub Flow** with Conventional Commits. Details in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

- Branch per change: `feat/`, `fix/`, `refactor/`, `docs/`, `chore/`.
- Commit subject ≤ 72 chars, imperative, Conventional Commits prefix (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`, `perf:`, `ci:`).
- **One concern per PR.** A bug fix does not bundle a refactor. A refactor does not bundle a feature.
- PR description must include: what changed, why, screenshots (for UI), and how to test.
- Do not force-push anywhere that isn't a WIP branch you own.

Before asking for review, self-check:

- [ ] `npm run typecheck && npm test && npm run lint` passes
- [ ] No stray `console.log`, TODO-without-issue, or commented-out code
- [ ] If you added a public API, it's documented in the relevant `docs/` file
- [ ] If you made an architectural choice, you wrote an ADR

## Security non-negotiables

Inherited from tmux-mobile and retained:

- Password + token required for all WebSocket connections.
- Token is compared by constant-time, password by constant-time.
- Backend binds `127.0.0.1` by default; public exposure is via an nginx reverse proxy with TLS termination.
- No secrets in `ps` output or logs. Load via `EnvironmentFile` when deploying.

See [`SECURITY.md`](./SECURITY.md) for the full model.

## Things that will bite you

- **xterm.js runs headless** (ADR-0005). `new Terminal({...})` is constructed without `term.open(el)`; we read `buffer.active` and render `<div class="tm-row">` children under `.tm-rows` ourselves. xterm owns no DOM, no renderer, no keyboard, no mouse. `onRender` does not fire — subscribe to `onWriteParsed` / `onScroll` / `onCursorMove` / `buffer.onBufferChange` instead.
- **Native touch scroll goes through a virtual scroll container** (ADR-0004, retained). The `Surface` owns `.tm-scroller`/`.tm-viewport`/`.tm-spacer`/`.tm-rows`. Do not attach your own `touchmove` handlers for vertical scroll; you'll fight the browser's native kinetic engine and lose.
- **Font metrics are load-bearing.** `styles/tokens.css` is the single source of truth for font family, size, `line-height` (px, not unitless), and `letter-spacing`. `cell-metrics.ts` measures glyph advance in px so `term.resize(cols, rows)` reflects the real grid. Drift breaks half-block Unicode chars (QR codes) and cursor alignment.
- **Alt-screen apps** (vim, htop, Claude Code full-screen) do not have tmux scrollback. We collapse the spacer when `buffer.active.type === "alternate"`. Do not try to "fix" this — it's a tmux limitation, not a bug.
- **Input is compose-bar-only; mouse is not forwarded.** See `project_input_paths.md` memory. Do not add direct-to-xterm keyboard or mouse paths without revisiting the design.
- **Virtual keyboard pushes the viewport.** Use `VisualViewport` API + CSS to keep the compose bar docked. Do not use `position: fixed`—it fights the virtual keyboard on iOS.
- **Pointer Events are the abstraction.** Do not write `touchstart`/`mousedown` pairs. One `pointerdown` handles both.
- **CSS media queries go LAST.** See the "Naming / CSS" note above. This already caused a prototype bug where `position: static` on a sidebar was silently overridden by a later base rule.

## What NOT to do

- Don't add features that aren't in the current roadmap phase without discussing first.
- Don't rewrite xterm. Don't rewrite tmux. Don't rewrite `node-pty`.
- Don't introduce a database before the roadmap says so. tmux is the persistence layer for v1.
- Don't add an AI-specific code path. This is a tmux client. An `aider` session is not semantically different from a `bash` session as far as this codebase is concerned.
- Don't fragment the source tree with half-implemented features. Ship or roll back.

## If you're lost

1. Check `docs/ROADMAP.md` for current phase—is the task you're doing actually in scope?
2. Check `docs/adr/` for past decisions—maybe someone already thought about this.
3. Read the relevant test file to understand expected behavior.
4. If still stuck, ask the user. Don't invent architecture.
