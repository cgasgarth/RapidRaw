# GitHub Actions Workflow Topology

Issue: #47 `ci(topology): split validation full-build image-quality performance and release workflows`

RawEngine keeps required PR checks fast enough for iteration while preserving
separate lanes for full builds, image-quality validation, performance
regression, and release packaging.

## Current Split

| Workflow                    | File                                                | Trigger                                     | Blocking status                     |
| --------------------------- | --------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| Baseline Validation         | `.github/workflows/lint.yml`                        | PRs, `main`, manual                         | Required through `PR CI / required` |
| Main Full Build             | `.github/workflows/ci.yml`                          | App-impacting `main` pushes and manual runs | Post-merge package signal           |
| Image Quality Regression    | `.github/workflows/image-quality.yml`               | manual                                      | Non-required readiness scaffold     |
| Performance Regression      | `.github/workflows/performance.yml`                 | manual                                      | Non-required readiness scaffold     |
| Release Build And Package   | `.github/workflows/release.yml`                     | manual, release created                     | Release-only                        |
| GitHub Action Version Audit | `.github/workflows/github-action-version-audit.yml` | schedule, manual                            | Non-required maintenance signal     |

## Merge Queue

Merge queue has been evaluated in
`docs/ci/merge-queue-evaluation-2026-06-12.md` and should not be enabled yet.
The current ruleset already requires the stable aggregate PR gate
`PR CI / required`; recent `main` validation has been dominated by hosted macOS
queue time, so adding merge-group runs would currently increase latency more
than it reduces merge risk.

Do not add `merge_group` triggers as a standalone cleanup. A future merge queue
implementation must also add merge-group changed-file routing because the
current required gate is intentionally PR-shaped.

## Required PR Gate

`PR CI / required` remains the only stable branch-protection status check. It
waits for the current required peer jobs, including the macOS no-bundle smoke
when path classification marks it required.

Do not add top-level path filters to required workflows. Required checks should
start, classify their own scope, and fail closed on workflow/config/Rust/Tauri
or unknown changes.

## Image-Quality And Performance Lanes

The image-quality and performance workflows currently verify that their planned
lanes are anchored in `RAW_EDITOR_PLAN.md`. They are scaffolds, not evidence of
render-quality or benchmark coverage.

Promotion from readiness lane to real validation requires:

- a linked validation issue;
- a deterministic local command;
- fixture/provenance rules for any image inputs;
- failure artifacts or benchmark reports;
- an update to `RAW_EDITOR_PLAN.md`;
- at least one successful manual run before any required-gate proposal.

## Concurrency Policy

PR validation should not cancel older queued or running checks because each PR
head needs independent merge evidence. `main` push validation is different:
newer main heads supersede older post-merge heads, so the always-on validation
workflows use a `main`-scoped concurrency group with `cancel-in-progress` enabled
only for `push` events on `refs/heads/main`. PR and manual runs use unique
per-run concurrency groups and continue independently.

`main` pushes should not enqueue macOS work that duplicates already-passed PR
coverage. Baseline validation keeps Ubuntu checks on every main push, but macOS
Rust check/clippy jobs run only for PRs that route to macOS smoke or for manual
workflow dispatches. The full package build workflow is path-filtered to
app-impacting changes so docs-only and planning-only merges do not consume
scarce macOS packaging runners while newer main validations are waiting.

## Active PR Queue Policy

GitHub Actions latency should be reduced by better workflow topology, not by
building up a large queue of overlapping pull requests. Shared CI, lint, lockfile,
generated artifact, and configuration changes should normally have only one
active implementation PR at a time. Keep follow-up work local until the active
overlapping PR merges or is closed.

When an open PR is only waiting on required macOS/Rust jobs, do not rebase or
force-push it unless it has become conflicting, failing, or branch protection
requires a fresh head. Head churn restarts the slow checks and makes the PR queue
look stale even when the code is healthy.

Every open PR needs an explicit disposition:

- merge it when branch protection allows;
- fix it when checks fail;
- close it when superseded or intentionally deferred;
- preserve useful closed work in a local branch until the queue has capacity.
