# RapidRAW CI Baseline Mirror

- Snapshot date: 2026-06-10
- Issue: #17 `baseline(ci): create minimal CI mirror of existing upstream commands`
- Workflow: `.github/workflows/lint.yml`

## Purpose

The baseline validation workflow mirrors the command results captured in #16. It
keeps passing baseline commands enforceable while still running known-failing
commands in separate visible jobs. This gives RawEngine early feedback without
blocking every PR on RapidRAW debt that has already been accepted and tracked.

## Blocking Jobs

| Job                                    | Commands                                        | Reason                                                 |
| -------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| `frontend: install, build, i18n check` | `npm ci`, `npm run build`, `npm run i18n:check` | These passed in the #16 baseline capture.              |
| `rust: fmt`                            | `cargo fmt -p RapidRAW -- --check`              | Rust formatting passed in #16.                         |
| `rust: cargo check macOS`              | `cargo check`                                   | macOS is the first supported platform.                 |
| `macOS app build baseline`             | reusable `.github/workflows/build.yml`          | Apple Silicon macOS packaging proved green in PR #291. |

The frontend build still has a large-chunk warning. That warning is accepted only
temporarily and is tracked by #288.

## Non-Blocking Baseline Jobs

| Job                            | Command                                                    | Debt issue |
| ------------------------------ | ---------------------------------------------------------- | ---------- |
| `frontend: typecheck baseline` | `npm run typecheck`                                        | #283       |
| `frontend: eslint baseline`    | `npm run lint`                                             | #286       |
| `frontend: prettier baseline`  | `npm run format:check`                                     | #289       |
| `frontend: i18n lint baseline` | `npm run i18n:lint`                                        | #285       |
| `rust: clippy baseline macOS`  | `cargo clippy --all-targets --all-features -- -D warnings` | #287       |

Each non-blocking job runs the real command, records any expected baseline
failure in the GitHub step summary, and then lets the job conclude successfully.
The temporary non-blocking wrapper should not be copied to new quality gates.

## Deliberate Choices

- Jobs run independently so GitHub Actions can execute checks in parallel.
- Node uses version `22` to match the inherited build workflow until Bun support
  lands through #21 and #22.
- Rust check and Clippy run on macOS because RawEngine is macOS-first and the
  Linux GTK/webkit dependency advisory is tracked separately by #262.
- Pull request app packaging is Apple Silicon macOS-only during this phase. The
  inherited Windows, Linux, Android, and Intel macOS matrix is deferred to #52 so
  unsupported or slow runner paths do not block macOS-first baseline work.
- The workflow keeps `workflow_dispatch` so baseline checks can be rerun manually
  while Actions behavior is being hardened.

## Next Tightening Steps

- Close #289, then remove the non-blocking wrapper from the Prettier job.
- Close #283, then remove the non-blocking wrapper from the TypeScript job.
- Close #286, then remove the non-blocking wrapper from the ESLint job.
- Close #285, then remove the non-blocking wrapper from the i18n lint job.
- Close #287, then remove the non-blocking wrapper from the Rust Clippy job.
- After all baseline debt jobs are blocking, close #42 by removing inherited
  non-blocking quality-gate behavior from required checks.
