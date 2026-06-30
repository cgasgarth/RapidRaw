# Known Limitations

- Snapshot date: 2026-06-11
- Issue: #258 `docs(limitations): add known limitations page`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-limitations`
- Baseline branch: `codex/docs-known-limitations`

## Purpose

This page records the current limitations users and contributors should know
while RawEngine is still hardening the RapidRAW fork. It is intentionally scoped
to known current behavior, deferred platform/release work, and validation gaps.

## Platform Support

RawEngine is currently macOS-first.

- The required PR quality gate focuses on Apple Silicon macOS.
- Windows, Linux, Android, and Intel macOS inherited build paths remain
  documented but are not yet the primary supported release target.
- Optional platform matrix work is tracked separately in
  [optional platform build matrix](../../ci/optional-platform-build-matrix-2026-06-11.md).

## Release Signing And Distribution

Release signing, notarization, and update distribution are not yet complete.

- Current release artifacts are unsigned unless a later release workflow proves
  otherwise.
- macOS signing and notarization placeholders are documented in
  [macOS signing and notarization placeholders](../macos/macos-signing-notarization-placeholders-2026-06-11.md).
- Unsigned release artifact behavior is documented in
  [unsigned release artifact workflow](unsigned-release-artifact-workflow-2026-06-11.md).
- Release metadata, checksum, and SBOM direction is documented in
  [release metadata, checksums, and SBOM](../evidence/release-metadata-checksums-sbom-2026-06-11.md).

## Validation Coverage

The validation foundation is improving, but not all planned product gates exist.

- The current CI gate covers frontend build/lint/typecheck baselines, Rust
  formatting/check/clippy baselines, dependency security checks, dependency
  license checks, generated-type drift, GitHub Actions linting, and macOS app
  smoke routing.
- Browser-only UI screenshots are not yet a reliable app validation substitute
  because the frontend relies on Tauri APIs during startup. The current render
  baseline records that limitation in
  [RapidRAW render baseline](../../baseline/rapidraw-render-baseline-2026-06-10.md).
- Golden image rendering, visual app screenshots, fixture manifests,
  performance budgets, and high-risk computational photography gates are still
  future work.
- PRs must continue to list exact validation commands, skipped checks, and
  residual risk.

## Dependency And Security State

Dependency checks are enforced, but one Rust advisory remains explicitly
deferred.

- JavaScript dependency security and license checks are blocking in CI.
- Rust dependency security and license checks are blocking in CI.
- `RUSTSEC-2024-0429` remains a known deferred Rust advisory and is documented
  in [deferred Rust advisories](../../security/deferred-rust-advisories.md).
- New advisory ignores should not be added without a matching tracked deferred
  advisory entry and exit criteria.

## Current Architecture Constraints

The current app still reflects inherited RapidRAW architecture constraints.

- Large orchestration surfaces remain in the React app shell and Rust Tauri
  command registration.
- Frontend command names and Rust command registration are manually mirrored.
- Adjustment payloads cross the Tauri boundary largely as JSON values rather
  than a shared versioned schema.
- Sidecar persistence is file-path based and colocated next to source images;
  there is no RawEngine catalog database yet.
- These constraints should be treated as baseline facts until dedicated
  architecture, sidecar, command-contract, and schema work changes them.

## Feature Scope Limitations

RawEngine's target product scope is much larger than the current implemented
RapidRAW baseline.

- Capture One/Lightroom-level color editing, full layers, advanced film
  simulation, negative processing lab, panorama stitching, HDR stacking, focus
  stacking, super-resolution stitching, and expert agent editing remain roadmap
  work unless a later PR documents them as implemented.
- High-risk color science, film/negative, stitching, stacking, super-resolution,
  and app-server agent work must start from ADRs, schemas, validation gates, and
  fixtures rather than UI-only changes.
- Planned OpenAI app-server agent integration and migration of built-in AI tools
  are not complete in this baseline.

## Fixture And Sample Data Limitations

The repo does not yet have the full fixture corpus needed for production-grade
image-quality validation.

- Public fixture policy and manifest work is still tracked separately.
- Heavy, restricted, or copyrighted fixtures may need external storage with
  hashes and provenance tracked in the repository.
- Until fixture gates exist, image-quality claims should be treated as
  unvalidated unless the PR includes specific local artifacts and comparison
  evidence.

## User-Facing Risk Notes

Until the release and validation gaps above are closed:

- Treat builds as development/baseline artifacts, not polished production
  releases.
- Keep originals backed up before relying on sidecar metadata operations.
- Treat AI, negative conversion, panorama, HDR, focus stacking, and
  super-resolution surfaces as baseline or planned capabilities unless their
  implementing PRs and validation evidence are linked.
- Treat performance targets as planning goals until benchmark gates record
  repeatable measurements on named hardware.
