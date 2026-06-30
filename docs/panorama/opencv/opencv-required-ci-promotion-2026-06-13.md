# OpenCV Required CI Promotion Criteria

- Issue: #999 `panorama(opencv): decide promotion criteria for required CI`
- Scope: panorama OpenCV backend CI gating
- Status: policy gate before OpenCV becomes required PR validation

## Decision

OpenCV panorama validation must graduate through explicit CI tiers. It should not
enter the required PR gate just because the crate compiles once on a developer
machine or a manually prepared runner.

Promotion order:

1. Manual spike workflow.
2. Nightly or scheduled validation.
3. Required PR validation for narrowly scoped backend coverage.
4. Default-enabled product behavior after separate packaging, quality, and
   fallback approval.

## Tier 0: Local Spike

Purpose:

- Prove the Rust crate can compile behind a disabled Cargo feature.
- Verify the adapter can report backend capability and unavailable states.
- Avoid adding any OpenCV dependency to normal development.

Required evidence:

- Local `cargo check` with the feature enabled.
- Local `cargo check` with default features and no OpenCV dependency.
- Missing-library behavior returns a typed unavailable backend result.
- No OpenCV-specific types leak into RawEngine schema samples or sidecars.

Exit criteria:

- A branch can build both with and without the OpenCV feature.
- The capability report describes the backend as `optional_spike`.
- The follow-up PR body records local OpenCV version, libclang path, and macOS
  architecture.

## Tier 1: Manual CI Spike

Purpose:

- Prove the feature-gated build can run on GitHub-hosted macOS without changing
  required PR checks.

Required evidence:

- Manual workflow installs or restores a pinned OpenCV dependency path.
- Workflow records `clang --version`, `brew info opencv`, OpenCV version,
  linked library paths, and `otool -L` output when an app binary exists.
- Workflow uploads build and runtime discovery logs on failure.
- Default PR workflow remains green when OpenCV is unavailable.

Exit criteria:

- Three successful manual runs on fresh heads.
- At least one successful run after cache miss.
- At least one expected missing-dependency failure fixture.

## Tier 2: Nightly CI

Purpose:

- Catch drift in OpenCV, Homebrew, Rust bindings, and macOS runner images without
  blocking ordinary PRs.

Required evidence:

- Nightly workflow runs the feature-gated OpenCV build.
- Synthetic fixture parity test compares legacy and OpenCV outputs.
- Memory and runtime telemetry is recorded.
- Failure artifacts include seam overlays or derived diagnostic images once
  rendering exists.

Exit criteria:

- Seven consecutive scheduled runs are green or failures are understood and
  issue-linked.
- Fixture outputs are deterministic for the pinned dependency policy.
- Cache strategy does not hide missing dependency behavior.

## Tier 3: Required PR CI

Purpose:

- Protect the main branch once OpenCV is stable enough that regressions matter
  for core panorama development.

Required evidence before promotion:

- macOS packaging status is `bundled` or `not_required`.
- Required PR CI can run without relying on ambient Homebrew state.
- The OpenCV feature can be validated with bounded runtime.
- Failure mode is diagnosable from uploaded logs.
- The aggregate gate starts early and polls peer jobs instead of serializing
  validation.
- Branch protection remains one stable required status: `PR CI / required`.

Allowed required coverage:

- Capability report schema validation.
- Missing-backend fallback.
- One small synthetic fixture parity test.
- Adapter compile check with bounded feature set.

Not allowed in required PR CI:

- Full large-panorama corpus.
- Release packaging or notarization.
- Long-running performance sweeps.
- Unpinned dependency installation that can change under the same commit.
- Any check that requires a developer-specific Homebrew path.

## Rollback Rules

Remove OpenCV from required PR CI immediately if:

- hosted macOS queue time becomes the dominant blocker for unrelated PRs;
- runner image changes make OpenCV unavailable or unstable;
- false failures exceed one per week without a deterministic fix;
- missing-library fallback regresses;
- packaging evidence becomes stale or contradicted by release testing.

Rollback must preserve local and nightly coverage where useful. Removing required
coverage is not permission to delete the capability report or fallback tests.

## Product Promotion Boundary

Required CI does not mean the feature is default-enabled. Default product
promotion additionally requires:

- UI controls and fallback states;
- app-server backend selection support;
- editable panorama artifact preservation;
- quality evidence against real photo fixtures;
- packaging, codesigning, and notarization proof;
- release notes and dependency notices.
