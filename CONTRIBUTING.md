# Contributing to TM-Agent

We use a **lightweight GitHub Flow** with Conventional Commits and ADRs for architectural decisions. This document is the source of truth for workflow; `CLAUDE.md` imports from here.

## Working agreement

- **Main is always deployable.** If a test or build is broken on main, dropping whatever you're doing to fix it is fine and expected.
- **Small PRs.** Target: ≤ 400 lines diff, one concern per PR. Bigger changes get split.
- **Ship or roll back.** No half-finished features on main behind commented-out code. If it's not ready, branch.
- **Write the test first for non-trivial logic.** It's not dogma, but when bugs appear in code without tests, we write the test before the fix.

## Branch naming

```
<type>/<short-slug>[-<issue-id>]
```

`type` ∈ `feat`, `fix`, `refactor`, `docs`, `chore`, `test`, `perf`, `ci`, `build`.

Examples: `feat/session-drawer`, `fix/compose-bar-ios-keyboard`, `refactor/extract-ansi-parser`.

## Commit messages

Conventional Commits 1.0. The subject line is all that's required for trivial commits; body is encouraged when the "why" isn't obvious.

```
<type>[(scope)]: <subject>

[optional body explaining motivation, constraints, tradeoffs]

[optional footer: BREAKING CHANGE, Refs #NN, Co-authored-by]
```

- `type` matches the branch type set above, plus `revert`.
- `scope` is optional; use a feature name (`sessions`, `compose`, `history`, `backend`, `ci`).
- `subject`: imperative mood, ≤ 72 chars, no trailing period.
- `BREAKING CHANGE:` footer for incompatible behavior changes even while < 1.0.

Examples:

```
feat(sessions): left-swipe on session card reveals kill action

Swipe-to-reveal uses @use-gesture threshold (60px). Kill action is
destructive, so we require a second tap on the revealed button rather
than commit-on-release. Tested on iOS 17 Safari and Android Chrome.

Refs #12
```

```
fix: media queries must go last to win cascade

Equal-specificity rules let source order decide. Moving desktop
@media to the end of the stylesheet restores the sidebar layout.
Prototype bug report in conversation 2026-04-19.
```

## Pull requests

### Before opening

Run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If any fail, fix or push a WIP commit and open as a draft.

### PR template

```markdown
## What

<short, user-facing summary>

## Why

<problem or requirement; link issue if any>

## How

<notable implementation choices; anything a reviewer should see first>

## Screenshots (UI changes)

<before / after, mobile + desktop>

## Test plan

- [ ] unit: <relevant test files>
- [ ] integration: <if applicable>
- [ ] manual: <steps performed>
- [ ] typecheck / lint / build clean
```

### Review

- One reviewer minimum. Solo contributors self-review after a 24-hour pause or a cold second pass; do not merge same minute as commit.
- Reviewer checks: PRD / roadmap alignment, design principles compliance, test coverage, no dead code, security impact.
- Blocking comments must be concrete and actionable. Nits should be marked as such.

### Merging

- **Squash merge** by default. PR title becomes the squash commit subject (Conventional Commits applies).
- Only the PR author merges their own PR after approval—unless blocked.

## Architecture Decision Records (ADR)

Any non-trivial or hard-to-reverse choice gets an ADR.

- Format: `docs/adr/NNNN-short-title.md`, monotonically numbered.
- Template:

```markdown
# NNNN. Title

- Status: [proposed | accepted | superseded by NNNN | rejected]
- Date: YYYY-MM-DD
- Deciders: @handle, @handle

## Context

What problem forced this choice? What constraints apply?

## Decision

The thing we're doing, stated in one or two sentences.

## Alternatives considered

What else we looked at and why we didn't pick it.

## Consequences

What becomes easier, what becomes harder, what's now locked in.
```

A PR that needs an ADR includes it in the same PR.

## Versioning

- Pre-1.0 we live on `0.0.x`. Patch bump per release, minor bump for a public-interface-breaking release, once we define a public interface.
- Post-1.0 we follow semver strictly.

## Definition of Done

A story or task is **done** when:

1. Acceptance criteria from PRD pass manually on at least one mobile device + one desktop browser.
2. Tests at the appropriate level exist and pass.
3. `npm run typecheck && npm run lint && npm test && npm run build` all pass.
4. Relevant docs updated (PRD revision log, ARCHITECTURE, or ADR).
5. PR is squash-merged to main.
6. If UI-visible: screenshots attached to the PR.

## Issue tracking

GitHub Issues. Labels (minimal):

- `type/bug`, `type/feat`, `type/chore`, `type/docs`
- `area/frontend`, `area/backend`, `area/design`, `area/infra`
- `priority/now`, `priority/next`, `priority/later`
- `good-first-issue` when appropriate

Each PR references at least one issue (`Closes #NN` or `Refs #NN`).

## What to do when something's wrong

- **Test flaky**: don't retry-loop it. Mark `.skip()` with a TODO linking an issue, open the issue.
- **Type error you can't figure out**: don't `as any`. Ask. The time-to-correctness outweighs the typing cost.
- **Merge conflict on main**: rebase, don't merge-back. Keep history linear.
- **Surprise architectural question**: stop, write an ADR draft (status: proposed), discuss, then implement.

## Licensing

MIT. By contributing, you agree your contributions are licensed under the same.
