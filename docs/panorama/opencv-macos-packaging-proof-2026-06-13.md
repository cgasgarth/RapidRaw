# OpenCV macOS Packaging Proof

- Issue: #998 `panorama(opencv): document macOS packaging and codesigning proof`
- Scope: macOS-first OpenCV backend readiness for Panorama Stitching
- Status: planning gate before any OpenCV backend can move from optional spike
  to required CI or default-enabled product behavior

## Decision

OpenCV may be evaluated as an optional panorama backend, but it must not become
default-enabled, required in PR CI, or part of the release artifact until RawEngine
has a repeatable macOS packaging proof.

The first OpenCV spike may use a developer-installed dependency path, but that
path is research-only. A shipped RawEngine app must either bundle the required
OpenCV runtime libraries inside the `.app` or prove that the app can run without
OpenCV when the optional backend is unavailable.

## Current External Requirements

The `opencv` Rust crate expects a system OpenCV installation at build time and
uses OpenCV headers plus libclang for binding generation. Current upstream
macOS guidance for `opencv-rust` recommends Homebrew OpenCV, a working C++
compiler, and libclang/Xcode Command Line Tools. It also notes that Homebrew
OpenCV can usually be detected automatically and that manual builds need
environment variables for OpenCV libraries, include paths, and link paths.

Primary references checked on 2026-06-13:

- <https://github.com/twistedfall/opencv-rust/blob/master/INSTALL.md>
- <https://github.com/twistedfall/opencv-rust>
- <https://docs.rs/opencv/latest/opencv/>

## Packaging Modes

### Mode A: Developer System Dependency

Purpose:

- Enable local experimentation on machines with Homebrew OpenCV installed.
- Keep the spike feature-gated and excluded from required CI.

Requirements:

- Cargo feature is off by default.
- App starts and all non-OpenCV panorama paths work without OpenCV installed.
- Missing OpenCV produces a typed unavailable-backend result, not a panic.
- Capability report marks `macosPackagingStatus` as `system_dependency_spike`.
- CI tier is manual or nightly only.

This mode is not sufficient for release.

### Mode B: Bundled Runtime

Purpose:

- Make OpenCV available inside the macOS app bundle without requiring users to
  install Homebrew or set environment variables.

Requirements:

- The release build records every bundled OpenCV dynamic library and transitive
  runtime dependency.
- Library install names are rewritten for app-relative loading where needed.
- The `.app` launches on a clean macOS machine or clean runner image without
  Homebrew OpenCV.
- The panorama backend produces the same typed capability report at runtime as
  it did in CI.
- The release artifact includes license notices for OpenCV and any bundled
  transitive libraries.

This is the minimum mode for default-enabled release behavior.

### Mode C: Optional External Plugin

Purpose:

- Keep OpenCV outside the core app bundle while still allowing advanced users to
  install it.

Requirements:

- User-visible install and troubleshooting flow.
- Runtime discovery that does not rely on shell profile environment variables.
- Clear unsupported state for missing, incompatible, unsigned, or quarantined
  libraries.
- No required CI dependency on the external plugin.

This mode is acceptable only if the product intentionally treats OpenCV as an
advanced optional backend.

## Codesigning And Notarization Proof

Before any bundled OpenCV backend can ship, the release workflow must prove:

- every bundled OpenCV library is included in the codesigned app bundle;
- `codesign --verify --deep --strict` succeeds on the built `.app`;
- notarization succeeds for the packaged artifact;
- stapling succeeds when the release workflow produces a distributable package;
- a clean-machine launch smoke test can load the backend or degrade cleanly;
- the app can open the panorama tool without requiring unsigned external code;
- `otool -L` output for the app binary and bundled libraries is captured as a
  CI artifact for review.

The proof should live in release artifacts, not only in a developer note.

## CI Promotion Rules

OpenCV backend work starts in `manual_spike` CI.

It can move to nightly CI only after:

- the feature-gated build passes on macOS with pinned dependency instructions;
- a synthetic fixture parity test exists against the legacy backend;
- missing-library behavior is covered by a test or fixture;
- a capability report declares all external dependencies and packaging blockers.

It can move to required PR CI only after:

- a bundled or no-external-dependency packaging path is proven;
- required CI can run without Homebrew state leaking from the runner image;
- action/cache behavior is deterministic for OpenCV dependencies;
- failure logs include build, link, runtime discovery, and `otool` diagnostics;
- the backend is still optional at runtime unless product promotion has been
  separately approved.

It can become default-enabled only after:

- required CI is green for the backend;
- packaging and notarization proof is green;
- fixture parity and quality thresholds are documented;
- performance and memory thresholds are documented;
- user-visible fallback behavior is implemented.

## Implementation Checklist

- Add a Cargo feature such as `panorama-opencv-spike`, disabled by default.
- Keep OpenCV-specific types behind an adapter boundary so schema artifacts use
  RawEngine capability names, not crate-specific types.
- Add a runtime capability probe that returns availability, version, linked
  library paths, disabled reason, and packaging status.
- Add a missing-dependency test path that exercises backend selection without
  OpenCV installed.
- Add a macOS manual workflow that records `brew info opencv`, `clang --version`,
  `otool -L`, and app launch results for the spike.
- Add release packaging proof only after the spike proves the backend is worth
  carrying.

## Product Requirements

User-facing behavior must be calm and professional:

- If OpenCV is unavailable, the panorama UI should still open and use the legacy
  backend or show an unavailable advanced backend state.
- Users must not see compiler, linker, Homebrew, or dynamic-loader errors.
- The app-server editing agent must see structured capability data so it can
  choose an available backend without trial-and-error tool calls.
- Project files and derived panorama artifacts must not become unreadable when
  OpenCV is unavailable on another machine.

## Open Questions

- Whether RawEngine should eventually bundle OpenCV or keep it as an optional
  advanced backend.
- Whether the OpenCV crate build should be isolated behind a separate crate to
  reduce normal compile graph risk.
- Whether Hugin/libpano should remain a reference-only comparison path or become
  another optional backend candidate.
- Whether multi-band blending quality from OpenCV is enough to justify the
  packaging and release complexity.
