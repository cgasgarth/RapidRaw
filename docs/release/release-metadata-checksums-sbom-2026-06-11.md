# Release Metadata, Checksums, And SBOM

- Date: 2026-06-11
- Issue: #55 `ci(release): add SBOM and checksum generation`
- Workflows: `.github/workflows/build.yml`, `.github/workflows/release.yml`

## Purpose

Release and release-dry-run builds should produce reviewable metadata alongside
platform artifacts. This gives maintainers checksum evidence for generated files
and a source dependency SBOM before signing/notarization is enforced.

## Generated Files

Each reusable build job writes release metadata under
`$RUNNER_TEMP/release-metadata`.

| File                      | Producer                               | Scope                                                                   |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `*_checksums.sha256`      | `scripts/release/generate-release-metadata.ts` | SHA-256 hashes for matched release artifact files in that platform row. |
| `*_release-metadata.json` | `scripts/release/generate-release-metadata.ts` | Machine-readable list of matched files and their SHA-256 hashes.        |
| `source_sbom.spdx.json`   | GitHub dependency graph SBOM API       | Source dependency SBOM generated once from the Apple Silicon macOS row. |

## Upload Behavior

- GitHub `release` events upload metadata files to the target GitHub release.
- Manual unsigned release dry runs upload metadata as workflow artifacts.
- Main branch CI uploads metadata artifacts for build rows when
  `upload-artifacts` is enabled.
- Missing artifact matches produce an empty checksum manifest rather than
  failing the build. This keeps early inherited matrix rows observable while
  artifact coverage is tightened in follow-up work.

## Current Limits

- The SBOM is repository/source dependency oriented, not a binary composition
  SBOM for every generated installer.
- Checksums cover files that remain on disk after each platform build.
- Tauri release upload renaming can differ from local build output names; future
  release hardening should reconcile uploaded asset names with checksum entries.
- Signing, notarization, and stapling are still tracked separately.

## Validation

- `bun run check:release-metadata` validates the checksum generator with a local
  synthetic fixture.
- `bun run check:actions` validates workflow syntax.
- Release dry runs should verify that metadata artifacts are present for each
  expected platform row.
