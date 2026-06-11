# GitHub Actions Workflow Topology

Issue: #47 `ci(topology): split validation full-build image-quality performance and release workflows`

RawEngine keeps required PR checks fast enough for iteration while preserving
separate lanes for full builds, image-quality validation, performance
regression, and release packaging.

## Current Split

| Workflow                    | File                                                | Trigger                 | Blocking status                     |
| --------------------------- | --------------------------------------------------- | ----------------------- | ----------------------------------- |
| Baseline Validation         | `.github/workflows/lint.yml`                        | PRs, `main`, manual     | Required through `PR CI / required` |
| Main Full Build             | `.github/workflows/ci.yml`                          | `main` pushes           | Required post-merge signal          |
| Image Quality Regression    | `.github/workflows/image-quality.yml`               | manual                  | Non-required readiness scaffold     |
| Performance Regression      | `.github/workflows/performance.yml`                 | manual                  | Non-required readiness scaffold     |
| Release Build And Package   | `.github/workflows/release.yml`                     | manual, release created | Release-only                        |
| GitHub Action Version Audit | `.github/workflows/github-action-version-audit.yml` | schedule, manual        | Non-required maintenance signal     |

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

PR and `main` validation should not cancel older queued or running checks. GitHub
Actions is allowed to finish evidence for older commits. Speed work should come
from parallel jobs, tighter path routing inside always-starting workflows,
caching, and smaller validation commands.
