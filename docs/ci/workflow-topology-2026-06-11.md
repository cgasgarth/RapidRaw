# GitHub Actions Workflow Topology

Issue: #47 `ci(topology): split validation full-build image-quality performance and release workflows`

RawEngine keeps required PR checks fast enough for iteration while preserving
separate lanes for full builds, image-quality validation, performance
regression, and release packaging.

## Current Split

| Workflow                    | File                                                | Trigger                 | Blocking status                     |
| --------------------------- | --------------------------------------------------- | ----------------------- | ----------------------------------- |
| Baseline Validation         | `.github/workflows/lint.yml`                        | PRs, `main`, manual     | Required through `PR CI / required` |
| Manual Full Build           | `.github/workflows/ci.yml`                          | manual                  | On-demand package signal            |
| Image Quality Regression    | `.github/workflows/image-quality.yml`               | manual                  | Non-required readiness scaffold     |
| Performance Regression      | `.github/workflows/performance.yml`                 | manual                  | Non-required readiness scaffold     |
| Release Build And Package   | `.github/workflows/release.yml`                     | manual, release created | Release-only                        |
| GitHub Action Version Audit | `.github/workflows/github-action-version-audit.yml` | schedule, manual        | Non-required maintenance signal     |

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
starts after changed-path routing, reports to GitHub early, and polls the
current required peer jobs, including the macOS no-bundle smoke when path
classification marks it required. Do not make the aggregate job depend on every
peer job through `needs`; that leaves the branch-protection status unreported
while macOS runners are queued and makes otherwise healthy pull requests look
stale.

The peer jobs should remain independent so frontend, docs, schema, Rust, and
security checks can all dispatch as soon as the workflow starts. The aggregate
may fail early when a completed required peer job fails, but it should not
serialize the real validation work.

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
head needs independent merge evidence. `main` push validation should also avoid
workflow-level concurrency groups: a newer main run must be able to start
without waiting for, canceling, or being grouped with an older main run. Hosted
runner capacity can still queue jobs, but RawEngine should not add GitHub
Actions configuration that serializes main heads.

`tests/integration/checks/check-github-workflow-policy.ts` enforces this by rejecting any
workflow that runs on push to `main` and defines `concurrency`. Its self-test
covers block, inline, and scalar `main` branch declarations so a shorthand YAML
edit cannot bypass the policy. Keep that guard in the required
`github actions: actionlint` lane whenever workflow topology is changed.

`main` pushes should not enqueue macOS work that duplicates already-passed PR
coverage. Baseline validation keeps Ubuntu checks on every main push, but macOS
Rust check/clippy jobs run only for PRs that route to macOS smoke or for manual
workflow dispatches. The full package build workflow is manual-only so routine
main validation cannot build a hosted macOS packaging backlog while newer main
validations are waiting. Release packaging still runs from the release workflow.

Workflow-only and GitHub composite-action changes should not route to macOS
smoke by default. They are covered by actionlint, pinned-action audit, the
aggregate PR gate, and any normal Ubuntu jobs that exercise the changed action.
If a workflow change also touches `src-tauri`, lockfiles, package manifests, or
build configuration, those app-impacting paths still route to the appropriate
macOS smoke mode.

## Active PR Queue Policy

GitHub Actions latency should be reduced by better workflow topology, not by
building up a large queue of overlapping pull requests. Shared CI, lint, lockfile,
generated artifact, and configuration changes should normally have only one
active implementation PR at a time. Keep no more than two active open PRs total;
the second slot exists for a deliberate A/B pattern where one PR is building
while another independent PR is prepared or validated. Keep follow-up work local
until the active overlapping PR merges or is closed.

When an open PR is only waiting on required macOS/Rust jobs, do not rebase or
force-push it unless it has become conflicting, failing, or branch protection
requires a fresh head. Head churn restarts the slow checks and makes the PR queue
look stale even when the code is healthy.

Every open PR needs an explicit disposition:

- merge it when branch protection allows;
- fix it when checks fail;
- close it when superseded or intentionally deferred;
- preserve useful closed work in a local branch until the queue has capacity.
