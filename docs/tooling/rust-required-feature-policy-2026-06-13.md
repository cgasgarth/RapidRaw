# Rust Required Feature Policy

- Issue: #1006 `ci(rust): define required feature policy before OpenCV spike`
- Scope: Rust feature selection for required PR CI
- Status: required before adding optional native OpenCV dependencies

## Decision

Required Rust PR checks use the explicit Cargo feature set `required-ci`.
Required CI must not use broad `--all-features` for `src-tauri`.

Reason: once RawEngine adds optional native integrations such as an OpenCV
panorama spike, `--all-features` stops meaning "strict required validation" and
starts meaning "compile every experimental external backend on every PR." That
would accidentally promote Homebrew/libclang/OpenCV availability into the
required gate before packaging proof exists.

## Required Commands

Required Rust CI and local scripts should use:

```bash
cargo check --locked --no-default-features --features required-ci
cargo clippy --locked --all-targets --no-default-features --features required-ci -- -D warnings
cargo test --locked --all-targets --no-default-features --features required-ci --no-fail-fast
```

The default feature set includes `required-ci`, so normal developer builds still
work without passing feature flags. Required CI passes the feature flags
explicitly so future optional native backends cannot enter the required gate by
accident.

## Optional Native Backends

Optional native backends must use their own named feature, for example
`panorama-opencv-spike`.

Before such a feature can be required:

- it must have manual or nightly CI coverage;
- it must not rely on ambient Homebrew state in required PR CI;
- it must have dependency, license, and packaging evidence;
- it must have unavailable-backend fallback behavior;
- it must have explicit promotion criteria in the relevant feature plan.

## Enforcement

`bun run check:rust-feature-policy` validates:

- `package.json` Rust scripts use the explicit `required-ci` feature set;
- `.github/workflows/lint.yml` required Rust jobs use the same feature set;
- required Rust checks do not reintroduce `--all-features`.

`bun run check:actions` includes this policy check so workflow changes cannot
silently weaken the feature gate.
