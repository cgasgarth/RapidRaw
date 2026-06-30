# macOS Notarization Workflow

- Snapshot date: 2026-06-11
- Issue: #250 `release(macos): add notarization workflow`
- Repository: `cgasgarth/RapidRaw`
- Local checkout:
  `/Users/cgas/Documents/RawEngine/RapidRaw-release-notarization`
- Branch: `codex/release-notarization-workflow`

## Purpose

This document defines the planned macOS notarization workflow for RawEngine
release artifacts. It does not add notarization jobs to GitHub Actions yet. The
workflow should land only after signing secrets, artifact naming, and release
publishing are finalized.

Primary source:

- [Tauri macOS code signing guide](https://v2.tauri.app/distribute/sign/macos/)

Related local docs:

- [macOS signing and notarization placeholders](macos-signing-notarization-placeholders-2026-06-11.md)
- [unsigned release artifact workflow](../process/unsigned-release-artifact-workflow-2026-06-11.md)
- [release metadata, checksums, and SBOM](../evidence/release-metadata-checksums-sbom-2026-06-11.md)

## Recommendation

Use Apple notarization for public macOS artifacts before marking any release as
stable. The first production workflow should be manually triggered or tag-driven,
not run on ordinary pull requests.

## Required Inputs

| Input                     | Source                            | Notes                                          |
| ------------------------- | --------------------------------- | ---------------------------------------------- |
| Signed macOS app artifact | Release build job                 | Must be signed before notarization.            |
| Apple credentials         | GitHub Actions secrets            | Use App Store Connect API keys where possible. |
| Team ID                   | GitHub Actions variable or secret | Required by Apple tooling.                     |
| Bundle identifier         | Tauri config                      | Must match signing/notarization expectations.  |
| Artifact metadata         | Release metadata step             | Needed for checksums and provenance.           |

## Workflow Order

1. Build macOS release artifact.
2. Sign the app bundle and packaging artifact.
3. Submit artifact to Apple notarization service.
4. Wait for notarization result.
5. Fetch and store notarization log on failure.
6. Staple notarization ticket where supported.
7. Verify staple result.
8. Run Gatekeeper assessment.
9. Generate checksums and SBOM.
10. Upload release artifacts and validation evidence.

## Failure Policy

The notarization workflow should fail closed.

- If notarization fails, do not publish the artifact as a stable release.
- If the notarization log cannot be fetched, mark the run failed and preserve
  local workflow logs.
- If stapling fails after successful notarization, fail the stable release job
  and document the reason.
- If Gatekeeper assessment fails, block publication.

## GitHub Actions Shape

Future workflow jobs should be split so release failures are obvious:

- `macos-release-build`
- `macos-code-sign`
- `macos-notarize`
- `macos-staple-and-assess`
- `release-metadata`
- `publish-release`

Notarization should depend on signing, and publishing should depend on
notarization plus metadata.

## Validation Evidence

Each notarized release should retain:

- notarization request identifier;
- notarization status;
- notarization log on failure;
- stapling verification output;
- Gatekeeper assessment output;
- final artifact SHA-256;
- SBOM path;
- release notes path;
- exact workflow run URL.

## Out Of Scope

- Mac App Store distribution.
- Automatic update publication.
- Intel macOS support unless a later release target decision adds it.
- User-facing release marketing copy.

## Follow-Up Work

- Add production signing workflow.
- Add notarization GitHub Actions job.
- Add release artifact verification script.
- Add update manifest generation after notarized artifacts exist.
- Add release rollback and retraction runbook.
