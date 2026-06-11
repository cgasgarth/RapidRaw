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

These commands are intentionally available by name even when inherited baseline
work remains. They should become part of `check` or `check:quick` only after the
corresponding cleanup issues close and the commands are green on main.

| Command                     | Current ownership                                                |
| --------------------------- | ---------------------------------------------------------------- |
| `bun run check:lint`        | Strict ESLint gate, tracked by #286 and #29-#37.                 |
| `bun run check:format`      | Strict Prettier gate, tracked by #289.                           |
| `bun run i18n:lint`         | Hardcoded-string lint, tracked by #285.                          |
| `bun run check:rust:fmt`    | Rust formatting, mirrors current CI.                             |
| `bun run check:rust:check`  | Rust cargo check, mirrors current CI.                            |
| `bun run check:rust:clippy` | Rust clippy warnings-as-errors, tracked by #287 if it regresses. |
| `bun run check:rust`        | Blocking Rust local bundle for Rust-affecting PRs.               |

## Known Baseline Gaps

Observed on June 10, 2026:

- `bun run lint` reports inherited ESLint findings, primarily
  `@typescript-eslint/no-explicit-any`; cleanup is tracked by #286 and #29-#37.
- `bun run format:check` reports 11 inherited formatting findings; cleanup is
  tracked by #289.
- `bun run i18n:lint` reports 36 inherited hardcoded-string findings; cleanup is
  tracked by #285.

Until those issues close, hooks should call `bun run check:quick` and PR authors
should run `bun run check` before pushing ordinary frontend changes.
