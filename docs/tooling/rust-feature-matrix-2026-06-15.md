# Rust Feature Matrix

- Issue: #1327
- Workflow: `.github/workflows/panorama-opencv-spike.yml`
- Gate: scheduled and manual, not ordinary PR

The required PR Rust checks stay on `--no-default-features --features required-ci` to keep pull requests fast and avoid platform dependency churn.

The weekly Rust feature matrix installs OpenCV on macOS and runs:

```sh
cargo check --locked --all-targets --all-features
cargo test --locked --all-targets --all-features opencv_spike -- --nocapture
```

This is the only workflow currently allowed to use `--all-features`. If new optional features are added, keep this matrix as the first scheduled detector before promoting any optional-feature gate to ordinary PR CI.

## Local Probe

June 15, 2026 local `cargo check --locked --all-targets --all-features`
reached OpenCV discovery and failed because the local Homebrew OpenCV prefix was
stale:

```text
Failed to find installed OpenCV package using probes: environment, pkg_config, cmake, vcpkg_cmake, vcpkg
```

Local evidence:

```sh
brew --prefix opencv
# /opt/homebrew/opt/opencv
pkg-config --modversion opencv4
# No package 'opencv4' found
```

The scheduled GitHub workflow remains the right default detector because it
installs `opencv`, `llvm`, and `pkg-config` before running the all-features
matrix. Ordinary PR CI must continue using `required-ci` until OpenCV packaging
and local dependency setup are proven stable.

## Policy Guard

`bun run check:rust-feature-policy` verifies that ordinary Rust gates stay on
`--no-default-features --features required-ci` and that the only allowed
all-features workflow is the scheduled/manual OpenCV spike matrix.

`bun run check:rust-feature-policy:self-test` covers:

- valid required-CI plus scheduled all-features configuration;
- rejection of `--all-features` in required workflow files;
- rejection of an all-features matrix without a schedule.
