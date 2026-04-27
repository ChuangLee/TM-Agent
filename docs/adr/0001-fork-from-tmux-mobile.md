# 0001. Fork backend from tmux-mobile, rewrite frontend

- Status: accepted
- Date: 2026-04-19
- Deciders: @ChuangLee

## Context

We want a touch-first tmux client. Two starting points were viable:

1. **Greenfield**: new repo, new backend, new frontend.
2. **Fork tmux-mobile**: keep its backend (WebSocket, PTY bridge, auth, tmux gateway, state monitor), replace its frontend.

tmux-mobile's backend is small (≈ 2 kloc TS), test-covered, already solving the hard problems (PTY multiplexing, per-client grouped sessions, tmux state polling). It even added env-var support for stable tokens during our recent deployment. Its frontend, by contrast, embeds tmux interactions in desktop-shaped UI (prefix-key semantics, modal scrollback popup, canvas-only selection). The frontend is the part we want to replace.

## Decision

We fork tmux-mobile's backend into `src/backend/` in the new `TM-Agent` repo, preserve file layout and module boundaries, and rename environment variables from `TMUX_MOBILE_*` to `TM_AGENT_*`. The frontend is written from scratch as a new React 19 + Vite + Tailwind v4 SPA under `src/frontend/`.

Cloudflared quick-tunnel support is dropped. Deployment uses nginx reverse proxy (as we already do in production).

## Alternatives considered

- **Greenfield backend**: rejected. The backend is not where the product differentiates, and rewriting it costs weeks without user-visible value. We'd redo `node-pty` adapters, tmux CLI formatting, auth, state polling—all solved work.
- **In-place rewrite of tmux-mobile's frontend** on the same repo: rejected. The brand, roadmap, and non-goals have diverged too much. Naming, README, and SECURITY model all need to change. A separate repo makes the boundary clean, and we can cherry-pick backend fixes from upstream if we want.
- **Keep tmux-mobile frontend and iteratively improve**: rejected. The five design principles require deleting the modal scrollback popup, removing xterm-based scrollback, restructuring navigation. That's not iteration; that's a rewrite.

## Consequences

Easier:

- Shipping Phase 1 (live terminal + compose) in days, not weeks.
- Inheriting solid tests and fakes for backend work.
- Keeping the security model we already audited.

Harder:

- Tracking upstream tmux-mobile changes requires manual cherry-pick—no automatic merges. We accept this; tmux-mobile upstream moves slowly enough.
- Initial commit is large (ported code). We document the port lineage in this ADR and in each ported file's leading comment where non-obvious.

Locked:

- React + Vite + TypeScript stays for frontend. Reversing this requires a later ADR.
- Node backend stays. Adding another backend language requires a later ADR.
- env var naming becomes `TM_AGENT_*`. Any ops automation inheriting from tmux-mobile must be updated during deployment migration.
