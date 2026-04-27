# 0002. Zustand for frontend state, not Redux

- Status: accepted
- Date: 2026-04-19
- Deciders: @ChuangLee

## Context

The frontend needs a global state layer for: auth, current session/window/pane, UI open-flags (drawer/sheet/history/smart-keys), received PTY buffer, session snapshots.

Four mainstream options in the React 19 ecosystem:

1. **Redux Toolkit**: mature, big, opinionated, middleware-rich.
2. **Zustand**: tiny (~1 kB gzipped), hook-first, slice-based, no boilerplate.
3. **Jotai**: atom-based, good for fine-grained reactivity.
4. **Context + reducers**: zero deps; coarse-grained rerenders a risk.

## Decision

Use **Zustand**. One store per domain (`useAuthStore`, `useSessionsStore`, `useTerminalStore`, `useUIStore`). Cross-store selectors live in `src/frontend/lib/state/`.

## Alternatives considered

- **Redux Toolkit**: rejected. Boilerplate is disproportionate to app size; we don't need time-travel debugging or action logs at this stage; middlewares we'd use (thunks, listeners) have lighter equivalents.
- **Jotai**: rejected for now. Atom-based reactivity is lovely but the scope of our state is domain-shaped, which maps cleanly to stores. Revisit if we hit rerender-churn in the terminal buffer path.
- **Context + reducers**: rejected. Easy to start, but context coupling fights vertical slices—any one provider pulls in all consumers.

## Consequences

Easier:

- Tiny bundle impact.
- Per-slice `useStore(selector, shallow)` avoids rerender churn without extra work.
- Refactoring later to Jotai or Redux is mechanical if we keep store shapes simple.

Harder:

- No built-in devtools as rich as Redux DevTools; we use Zustand's middleware for a basic console log subscription in dev.

Locked:

- Zustand is a dev and prod dependency. Removing it requires an ADR.
