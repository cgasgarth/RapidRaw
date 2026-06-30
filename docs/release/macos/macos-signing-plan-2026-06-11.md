# macOS Signing Plan

- Snapshot date: 2026-06-11
- Issue: #249 `release(macos): add signing plan`
- Repository: `cgasgarth/RapidRaw`
- Local checkout:
  `/Users/cgas/Documents/RawEngine/RapidRaw-release-signing-plan`
- Branch: `codex/release-macos-signing-plan`

## Purpose

This plan defines the macOS code-signing path RawEngine should follow before
publishing a trusted public app artifact. It does not enable signing in CI yet;
that belongs with the notarization workflow and release artifact PRs.

Primary source:

- [Tauri macOS code signing guide](https://v2.tauri.app/distribute/sign/macos/)

Related local docs:

- [macOS signing and notarization placeholders](macos-signing-notarization-placeholders-2026-06-11.md)
- [unsigned release artifact workflow](../process/unsigned-release-artifact-workflow-2026-06-11.md)

## Recommendation

Use Apple Developer ID signing for macOS distribution outside the Mac App Store.
Treat signing as a release-only operation. Pull request builds should keep using
ordinary CI validation and no-bundle smoke checks; they should not require
production signing secrets.

## Required Assets

| Asset                                      | Storage                                         | Notes                                                             |
| ------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------- |
| Apple Developer ID Application certificate | GitHub Actions secret or release secret manager | Export as encrypted base64 `.p12`; never commit.                  |
| Certificate password                       | GitHub Actions secret                           | Separate from the certificate blob.                               |
| Apple team ID                              | GitHub Actions variable or secret               | Non-secret in many contexts, but keep release config centralized. |
| Apple ID / App Store Connect credentials   | GitHub Actions secrets                          | Needed for notarization, not for local unsigned smoke.            |
| Temporary keychain password                | Generated in workflow                           | Should not be reused across runs.                                 |

## Workflow Shape

1. Import the Developer ID certificate into a temporary CI keychain.
2. Build the macOS app with the release profile.
3. Sign the app bundle and generated disk image artifacts.
4. Notarize with Apple.
5. Staple notarization tickets where applicable.
6. Verify signatures, notarization status, and Gatekeeper assessment.
7. Generate checksums, SBOM, and release metadata.
8. Generate updater artifacts only after signing and notarization pass.

## Local Development Policy

- Local developer builds remain unsigned unless a developer intentionally
  configures personal signing outside the repo.
- PR validation must not require production Apple credentials.
- CI should fail closed when release signing is requested but secrets are absent.
- Signing secrets must never appear in logs, artifacts, caches, or generated
  metadata.

## Validation Gates

Before the signing workflow is considered production-ready, add checks for:

- certificate import success;
- expected signing identity is present in the temporary keychain;
- app bundle signature verifies;
- disk image or archive signature verifies;
- notarization request succeeds;
- staple verification succeeds where supported;
- Gatekeeper assessment succeeds on the final artifact;
- no signing secrets are printed;
- release metadata records signing and notarization status.

## Open Decisions

- Whether RawEngine will distribute a `.dmg`, `.app.tar.gz`, or both.
- Whether Intel macOS will be a release target.
- Whether signing is allowed on manual workflow dispatch only or also on tagged
  pushes.
- Whether release signing uses GitHub-hosted macOS runners only or a dedicated
  protected runner.

## Follow-Up Work

- Add notarization workflow.
- Add signing-secret documentation for maintainers.
- Add release artifact verification commands.
- Add update manifest generation after signed artifacts exist.
