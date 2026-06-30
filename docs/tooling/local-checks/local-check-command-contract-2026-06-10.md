# Local Check Command Contract

Issue: #38

This document records the local command contract added for RawEngine shift-left
validation. The commands intentionally mirror the CI job boundaries while keeping
the default local gates green on the current inherited RapidRAW baseline.

## Must-Pass Commands

| Command                  | Scope                                                     |
| ------------------------ | --------------------------------------------------------- |
| `bun run check:types`    | TypeScript `tsc --noEmit --pretty false`.                 |
| `bun run check:i18n`     | i18next extraction drift check.                           |
| `bun run check:quick`    | Fast local gate for hooks and frequent iteration.         |
| `bun run build:frontend` | Vite production frontend build.                           |
| `bun run check`          | Ordinary local PR gate: quick checks plus frontend build. |

## Explicit Strict Commands

These commands are intentionally available by name even when some inherited
baseline work remains. Commands that are green on main should be recorded in PR
validation whenever their scope is relevant.

| Command                             | Current ownership                                                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check:lint`                | Strict ESLint zero-warning gate.                                                                                                                |
| `bun run check:format`              | Strict Prettier gate.                                                                                                                           |
| `bun run i18n:lint`                 | Hardcoded-string lint, tracked by #285.                                                                                                         |
| `bun run check:rust:fmt`            | Rust formatting, mirrors current CI.                                                                                                            |
| `bun run check:rust:check`          | Rust cargo check, mirrors current CI.                                                                                                           |
| `bun run check:rust:clippy`         | Rust clippy warnings-as-errors, tracked by #287 if it regresses.                                                                                |
| `bun run check:rust:test`           | Rust test gate, mirrors current CI for Rust-affecting PRs.                                                                                      |
| `bun run check:rust`                | Blocking Rust local bundle for Rust-affecting PRs.                                                                                              |
| `bun run check:security`            | Dependency vulnerability checks for JS and Rust.                                                                                                |
| `bun run check:sidecar-roundtrip`   | Fixture-oriented validation for documented `.rrdata` sidecar shape, virtual-copy naming, tag conventions, and missing/invalid default behavior. |

## Known Baseline Gaps

Observed on June 10, 2026:

- `bun run lint` uses Biome for fast whole-repo linting.
- `bun run format:check` reports 11 inherited formatting findings; cleanup is
  tracked by #289.
- `bun run i18n:lint` reports 36 inherited hardcoded-string findings; cleanup is
  tracked by #285.

Until those issues close, hooks should call `bun run check:quick` and PR authors
should run `bun run check` before pushing ordinary frontend changes.

Updated on June 12, 2026:

- `bun run check:lint` is green on main and should remain a normal PR evidence
  command for lint-sensitive changes.
- `bun run check:format` is green on main and should remain a normal PR evidence
  command for formatting-sensitive changes.
- `bun run check:quick` remains the fast default local gate; broader PRs should
  add the named strict commands that match their touched surface.
