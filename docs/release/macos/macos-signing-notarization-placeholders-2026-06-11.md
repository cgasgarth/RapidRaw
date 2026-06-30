# macOS Signing And Notarization Placeholders

- Date: 2026-06-11
- Issue: #56 `ci(release): document signing and notarization placeholders`
- Scope: documentation only; no release credentials are added in this PR.

## Purpose

RawEngine needs a credible macOS release path before public release artifacts are
treated as shippable. The current release workflow can build inherited platform
artifacts, but macOS signing, notarization, stapling, and Gatekeeper validation
are not yet configured. This document records the placeholders and decisions
that must be resolved before signing is wired into GitHub Actions.

## Current Release State

- `.github/workflows/release.yml` runs when a GitHub release is created.
- Release jobs call the reusable `.github/workflows/build.yml` matrix.
- macOS release rows exist for Apple Silicon and Intel runners.
- Android signing placeholders already exist in `build.yml`.
- macOS jobs currently rely on unsigned Tauri build behavior.

## Required External References

- Apple notarization guide:
  https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple Developer ID overview:
  https://developer.apple.com/developer-id/
- Tauri v2 macOS signing guide:
  https://v2.tauri.app/distribute/sign/macos/
- Tauri v2 environment variables:
  https://v2.tauri.app/reference/environment-variables/

## Placeholder Secrets

Do not add these secrets until the certificate custody decision is approved.
When added, they should be repository or environment secrets scoped to release
workflows only.

| Secret                       | Purpose                                                    | Notes                                                                  |
| ---------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| `APPLE_CERTIFICATE`          | Base64 encoded Developer ID Application `.p12` certificate | Tauri can import this during CI signing.                               |
| `APPLE_CERTIFICATE_PASSWORD` | Password for the exported certificate                      | Store only in GitHub secrets or a future secret manager.               |
| `APPLE_TEAM_ID`              | Apple Developer Team ID                                    | Required for notarization authentication.                              |
| `APPLE_ID`                   | Apple account for notarization                             | Use only if choosing app-specific password auth.                       |
| `APPLE_PASSWORD`             | App-specific password or keychain/env indirection          | Prefer scoped credentials; do not use a personal password.             |
| `APPLE_API_KEY`              | App Store Connect API key ID                               | Preferred candidate for CI notarization if project policy approves it. |
| `APPLE_API_ISSUER`           | App Store Connect issuer ID                                | Paired with `APPLE_API_KEY`.                                           |
| `APPLE_API_KEY_PATH`         | Path to the App Store Connect `.p8` private key            | CI may write this file from a protected secret before invoking Tauri.  |
| `API_PRIVATE_KEYS_DIR`       | Directory containing App Store Connect private keys        | Alternative to passing an explicit `APPLE_API_KEY_PATH`.               |

## Required Decisions

1. Choose Developer ID distribution versus Mac App Store distribution.
2. Decide who owns the Apple Developer account and certificate lifecycle.
3. Decide whether CI uses app-specific password auth or App Store Connect API key auth.
4. Decide whether release signing runs on every release creation or only after an
   approved environment gate.
5. Define certificate rotation, revocation, and emergency release procedures.
6. Define hardened runtime and entitlement policy before enabling signing.
7. Define how notarization failures block release publication.
8. Define whether release assets are uploaded only after stapling succeeds.

## Workflow Placeholder Plan

The first signing implementation PR should keep release behavior explicit:

1. Add a release environment such as `production-release` with required reviewers.
2. Add macOS-only signing environment variables to the reusable build job.
3. Keep unsigned PR smoke builds separate from signed release builds.
4. Add a notarization/stapling step or use Tauri release signing when the
   environment variables are present.
5. Upload signed artifacts only after signing and notarization succeed.
6. Record signing identity, notarization UUID, stapling result, artifact name,
   and checksum in the release summary.

## Validation Gates To Add Later

- `validation:release-signing`: release workflow detects missing signing secrets
  before attempting a signed release.
- `validation:macos-notarization`: notarization succeeds for a signed app bundle
  or fails the release job with actionable diagnostics.
- `validation:macos-stapling`: stapled tickets are present on distributed macOS
  artifacts.
- `validation:gatekeeper`: a clean-machine or fresh-user Gatekeeper smoke opens
  the downloaded artifact without quarantine/signing errors.
- `validation:checksums`: release artifacts have uploaded checksum manifests.
- `validation:sbom`: release builds upload source dependency SBOM output.

## Non-Goals For This Placeholder

- No Apple credentials are generated, requested, or stored.
- No release workflow steps are changed.
- No app entitlement policy is chosen.
- No public release claim is made.
- No notarization is attempted locally.

## Follow-Up Issues

- #54 `ci(release): add unsigned release artifact workflow`
- #55 `ci(release): add SBOM and checksum generation`
- `release(macos): choose Developer ID versus Mac App Store strategy`
- `release(macos): define signing notarization and stapling pipeline`
- `release(macos): define hardened runtime and entitlements`
- `validation(macos): add clean-machine Gatekeeper install test`
