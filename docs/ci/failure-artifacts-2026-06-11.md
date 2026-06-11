# Failure Artifact Policy

Issue: #53 `ci(artifacts): upload build and failure artifacts`

RawEngine CI uploads short-lived diagnostics when expensive Tauri build jobs fail.
The goal is faster debugging without preserving broad build directories on every
successful run.

## Covered Jobs

- Reusable full build workflow: `.github/workflows/build.yml`
- PR macOS no-bundle smoke: `.github/workflows/lint.yml`

## Captured On Failure

- Build context: platform, target, mobile mode, ref, SHA, runner OS, and runner
  architecture.
- Storage context: `df -h` and high-level workspace directory sizes.
- Toolchain context: Rust, Cargo, Bun, Node, and Tauri CLI versions when
  available.
- Focused build outputs:
  - frontend `dist/`;
  - Cargo build script `output`, `stderr`, and `stdout` files;
  - Tauri bundle log files;
  - Android build reports and output logs when Android jobs are in scope.

## Retention

Failure diagnostics use a 7 day retention period. They are not release assets,
do not replace release checksums/SBOMs, and should not include fixture images or
raw photo assets unless a future issue explicitly adds fixture manifest coverage
for that path.

## Non-Goals

- Do not upload broad `src-tauri/target/**` trees on every failure.
- Do not weaken required checks to preserve artifacts.
- Do not add long-lived artifacts for successful PR smoke builds.
