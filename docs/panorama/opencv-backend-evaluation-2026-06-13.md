# OpenCV Panorama Backend Evaluation

- Date: 2026-06-13
- Issue: #984 `panorama(adapter): evaluate OpenCV stitching backend`
- Milestone: 11: Panorama Stitching
- Scope: evaluate whether OpenCV should become a RawEngine panorama backend.

## Summary

OpenCV should be treated as an optional future panorama engine spike behind the
RawEngine adapter boundary, not as an immediate default dependency.

The current RapidRaw stitcher should remain the default while RawEngine
stabilizes artifact persistence, dry-run planning, memory budgets, fixture
validation, and the backend contract. OpenCV can be valuable later for
projection, seam, exposure, and bundle-adjustment capabilities, but the
packaging, CI, FFI, and editability risks are too large to introduce before the
adapter and validation surface are proven.

## Recommendation

Use this order:

1. Keep the current RapidRaw homography stitcher as the legacy default backend.
2. Stabilize the RawEngine `PanoramaEngine` adapter contract around typed
   preflight, render, cancellation, progress, capability, and metadata
   structures.
3. Add deterministic fixture validation and review artifacts that can compare
   backend behavior.
4. Evaluate OpenCV in a separate feature-gated spike branch.
5. Promote OpenCV only if it can be packaged, validated, and shipped without
   weakening the macOS quality gate.

The first OpenCV PR should be a spike, not a product feature. It should prove
buildability, binary packaging, one tiny synthetic stitch, and metadata parity.

## Why Not Default Now

OpenCV introduces risks that are orthogonal to user-visible panorama quality:

- `opencv-rust` currently documents its API as usable but not heavily
  battle-tested.
- The crate requires a system OpenCV installation plus Clang/libclang for
  binding generation.
- macOS CI would need Homebrew or a vendored OpenCV strategy before the default
  gate could build it reproducibly.
- Tauri packaging must account for OpenCV dynamic libraries, codesigning,
  notarization, and app bundle relocation.
- The OpenCV binding surface follows generated C++ APIs, so Rust code can
  become difficult to isolate without a narrow adapter.
- OpenCV stitching APIs produce rendered raster outputs; RawEngine still needs
  editable artifact metadata, source provenance, invalidation, and preview
  contracts outside OpenCV.
- Large panorama memory behavior still needs RawEngine preflight and tiling
  guardrails. OpenCV does not remove that product requirement.
- Color management must remain RawEngine-owned. OpenCV can assist geometry and
  blending, but RAW-linear processing, lens correction order, profile handling,
  and export intent should not leak into a generic CV backend.

## Useful OpenCV Capabilities

OpenCV is still worth evaluating because its stitching module exposes a mature
set of building blocks:

- panorama and scan stitcher modes;
- multi-band, feather, and no-blend options;
- gain and channel exposure compensators;
- graph-cut, dynamic-programming, Voronoi, and no-seam finder options;
- wave correction modes;
- access to broader feature detection, matching, calibration, warping, and
  image processing modules.

Those capabilities map well to future RawEngine needs, especially projection
options, exposure normalization, seam strategy selection, multi-row support, and
performance comparisons against the legacy stitcher.

## Adapter Boundary

The OpenCV spike should not expose OpenCV types to the rest of the app. Keep
`cv::Mat`, OpenCV status codes, and OpenCV-specific parameter names inside the
backend implementation.

The public RawEngine adapter should expose:

- backend identifier and version metadata;
- capability report, including supported projections, blend modes, exposure
  normalization modes, seam methods, max recommended pixel count, and whether
  multi-row input is supported;
- preflight request and result with estimated memory, dimensions, expected
  warnings, blocked reasons, and selected execution mode;
- render request and result with stable artifact IDs, source metadata,
  transform summaries, quality metrics, warnings, and recoverable error codes;
- cancellation and progress event hooks;
- deterministic debug metadata that fixture tests can snapshot.

The adapter should translate OpenCV behavior into RawEngine decisions. If
OpenCV cannot provide a stable metric directly, the backend should state that
explicitly instead of inventing confidence values.

## CI And Packaging Plan

The OpenCV spike should start outside the default required gate:

1. Add an optional Cargo feature such as `opencv-panorama-spike`.
2. Add a macOS-only manual or nightly GitHub Actions job that installs OpenCV
   with Homebrew, builds the feature, and runs a tiny synthetic stitch test.
3. Keep the normal PR gate free of OpenCV until runtime packaging is proven.
4. Capture artifact size, library linkage, and build time in the PR evidence.
5. Add a release-packaging proof before enabling the feature by default.

The spike fails if it requires fragile global environment variables in the main
developer workflow, slows every PR, or cannot be packaged into a signed macOS
app without manual local setup.

## Validation Requirements

OpenCV should not be promoted beyond spike status until these checks exist:

- fixture manifest coverage for the source images used in backend comparisons;
- tiny synthetic stitch fixture that is generated locally, not checked in as a
  large binary;
- metadata parity tests for source count, output dimensions, projection,
  warnings, and quality metrics;
- visual review output with source placement overlays and seam diagnostics;
- memory preflight tests that run before render and block unsafe jobs;
- cancellation/progress smoke test for long-running jobs;
- release packaging proof for dynamic libraries and notarization path;
- license and SBOM evidence for OpenCV and the Rust binding.

## Follow-Up Issues

Created issue split:

- #993 `panorama(adapter): define backend capability contract`
- #994 `panorama(opencv): add feature-gated macOS build spike`
- #1001 `panorama(opencv): add synthetic fixture parity test`
- #998 `panorama(opencv): document macOS packaging and codesigning proof`
- #997 `panorama(opencv): compare seam and exposure strategies against legacy engine`
- #999 `panorama(opencv): decide promotion criteria for required CI`

## Source Notes

Primary references checked on 2026-06-13:

- `opencv-rust` README:
  <https://github.com/twistedfall/opencv-rust>
- `opencv-rust` install guide:
  <https://github.com/twistedfall/opencv-rust/blob/master/INSTALL.md>
- `opencv` crate docs:
  <https://docs.rs/opencv/latest/opencv/>
- `opencv::stitching` crate docs:
  <https://docs.rs/opencv/latest/opencv/stitching/index.html>
- OpenCV license:
  <https://github.com/opencv/opencv/blob/4.x/LICENSE>

## Validation

This evaluation is documentation-only. Required local checks for the PR:

- `bun run docs:check`
- `bun run format:check`
- `bun run check:unsafe-casts`
- `git diff --check`
