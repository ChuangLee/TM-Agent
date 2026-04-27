# 0007. Session Identity on the Wire & TopBar Switcher

- Status: accepted
- Date: 2026-04-21
- Deciders: @ChuangLee
- Chinese companion: [`0007-session-identity-and-switcher.zh.md`](./0007-session-identity-and-switcher.zh.md) (Chinese is the authoritative doc per project convention; this English version is a summary.)

## Context

The `attached` control-WS message carried only the **grouped client-session name** (`tm-agent-client-<clientId>`). The frontend tried to recover the real base session with a heuristic ("scan the snapshot, pick the first non-managed session"), which breaks as soon as the server has more than one base session: the TopBar label freezes on whichever base session tmux lists first, and `SessionList`'s `aria-current` highlight is equally unreliable.

Symptom: every link into `https://your-host.example` showed `mtmux` in the TopBar regardless of what the user picked, and switching sessions from the sidebar did not update the label.

## Decision

1. **Protocol**: extend `attached` with `baseSession: string`. The backend already knows both names at attach time (`attachControlToBaseSession` in `src/backend/server.ts`); plumb the base name through. `session` (the grouped alias) stays for transport needs.
2. **Store**: `sessions-store` gains `attachedBaseSession`. All UI that needs "which real session are we on" reads that field; the `selectBaseSession` scan is deleted.
3. **TopBar**: the session name moves next to the status dot as one left-aligned affordance. A chevron (`⌄`) appears **only when there are ≥2 base sessions**, signalling tap-to-switch. On mobile the affordance opens the `SessionDrawer`; on desktop it is pointer-inert (the permanent sidebar already shows the list).
4. **Last-session memory**: on `session_picker`, the client prefers the base session recorded in `localStorage['tm-agent:lastSession']` if it still exists in the list; otherwise falls back to `sessions[0]`. The key is written on every successful `attached`.

## Consequences

- Fixes both the stale label and the stale sidebar highlight in one move.
- Removes a load-bearing heuristic. `selectBaseSession` is gone; readers consume `attachedBaseSession` directly.
- `localStorage` memory is per-browser-profile. A user who opens the same token on phone + laptop may land on different sessions per device — preferable to the current "everybody always lands on `mtmux`".
- Backward-compat: old clients ignore the new `baseSession` field (Zod schema is additive). Old servers are not supported (we deploy both together).

## Non-goals

- No changes to how tmux grouped sessions are created; the transport layer is unchanged.
- No cross-device session memory. That would require a server-side key/value and is out of scope for v1.
