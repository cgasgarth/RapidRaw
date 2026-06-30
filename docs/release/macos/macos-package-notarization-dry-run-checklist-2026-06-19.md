# macOS Package And Notarization Dry-Run Checklist

- Snapshot date: 2026-06-19
- Issue: #2368 `release(macos): add notarization/package dry-run checklist`
- Repository: `cgasgarth/RapidRaw`
- Local checkout:
  `/Users/cgas/Documents/RawEngine/RapidRaw-macos-release-checklist`
- Branch: `codex/macos-release-checklist`
- Runtime status: release checklist only; no notarization credentials or release
  workflow mutations are added here.

## Purpose

This checklist defines the macOS-first package review path to run before
RawEngine treats any Tauri macOS artifact as public-release ready. It connects
the existing unsigned dry-run workflow, signing plan, notarization workflow, and
release metadata docs into one concrete operator checklist.

Related docs:

- [Unsigned release artifact workflow](../process/unsigned-release-artifact-workflow-2026-06-11.md)
- [macOS signing plan](macos-signing-plan-2026-06-11.md)
- [macOS notarization workflow](macos-notarization-workflow-2026-06-11.md)
- [macOS signing and notarization placeholders](macos-signing-notarization-placeholders-2026-06-11.md)
- [Release metadata, checksums, and SBOM](../evidence/release-metadata-checksums-sbom-2026-06-11.md)

## Current Packaging State

- `.github/workflows/release.yml` can run a manual `workflow_dispatch` build for
  a chosen ref and upload unsigned artifacts.
- `.github/workflows/build.yml` builds desktop packages through
  `tauri-apps/tauri-action` with `--verbose` and optional target arguments.
- macOS release rows currently cover `macos-14` with
  `aarch64-apple-darwin` and `macos-15-intel` with
  `x86_64-apple-darwin`.
- `src-tauri/tauri.conf.json` still uses the inherited bundle identifier
  `io.github.CyberTimon.RapidRAW`; public RawEngine release readiness must not
  be claimed until the identity decision is resolved.
- macOS signing, notarization, stapling, and Gatekeeper checks remain planned,
  not enabled release gates.

## Required Release Inputs

Do not run a signed/notarized release until these inputs are available and
approved:

| Input                    | Expected source                                | Dry-run expectation                     |
| ------------------------ | ---------------------------------------------- | --------------------------------------- |
| Clean release ref        | protected `main`, tag, or commit SHA           | Ref is recorded in PR/release evidence. |
| Apple Developer identity | approved Developer ID account                  | Not needed for unsigned package smoke.  |
| Certificate material     | protected release secret store                 | Never printed or committed.             |
| Notarization credentials | App Store Connect API key or approved fallback | Never required for PR validation.       |
| Bundle identifier        | Tauri config and Apple account                 | Must match release identity.            |
| Entitlements policy      | release hardening issue/PR                     | Must be reviewed before signing.        |
| Artifact naming policy   | release workflow                               | Names match checksum metadata.          |

## Local Unsigned Package Smoke

Run this only when a local macOS package smoke is practical. It proves local
packaging shape, not release shippability.

1. Confirm the intended repo and dependencies:

   ```sh
   bun run check:gh-repo-resolution
   bun install --frozen-lockfile
   ```

2. Run focused local validation for any packaging-doc or workflow change:

   ```sh
   bun run check:gh-repo-resolution
   bun run check:types
   ```

3. Prove the production frontend artifact contract:

   ```sh
   TAURI_ENV_DEBUG=1 bun run build:frontend
   bun run check:bundle
   ```

4. Build the local macOS target that matches the machine or review need:

   ```sh
   bun run tauri build --verbose --target aarch64-apple-darwin
   ```

   Use `--target x86_64-apple-darwin` only when the runner/toolchain is
   configured for Intel packaging.

5. Inspect generated files under `src-tauri/target/**/release/bundle/` and
   record:

   - `.app`, `.dmg`, `.app.tar.gz`, or updater artifacts present;
   - artifact names and sizes;
   - app bundle identifier and version;
   - `Info.plist` values for name, identifier, version, document types, and
     minimum system version;
   - bundled resources required for RAW editing, ONNX runtime, lens data, icons,
     and Tauri capabilities;
   - absence of obvious development endpoints, local paths, debug payloads, or
     secrets.

## Manual Workflow Dry Run

Use the unsigned release workflow for reproducible CI package evidence:

1. Open GitHub Actions.
2. Select `Release: Build & Package App`.
3. Run workflow against the target branch, tag, or commit SHA.
4. Confirm each macOS matrix row either uploads expected artifacts or records a
   known blocker.
5. Download artifacts and metadata from the workflow run.
6. Compare artifact names against checksum metadata from
   `*_release-metadata.json` and `*_checksums.sha256`.
7. Add the workflow run URL, artifact names, checksum file names, and any
   blockers to the issue or release evidence.

## Signed And Notarized Release Dry Run

This repo should not attempt notarization until signing credentials and release
environment protection are approved. When those are ready, the operator dry run
should prove:

1. The release job imports the expected Developer ID Application certificate
   into a temporary keychain.
2. The app bundle signature verifies with the expected Team ID.
3. The package artifact signature verifies.
4. Apple notarization submission completes successfully.
5. The notarization request identifier is recorded.
6. Stapling succeeds for the distributed artifact type where supported.
7. Gatekeeper assessment accepts the downloaded artifact.
8. Checksums and SBOM artifacts are present and match the final uploaded files.

Expected command shapes for local or CI evidence:

```sh
codesign --verify --deep --strict --verbose=2 path/to/RapidRAW.app
spctl --assess --type execute --verbose=4 path/to/RapidRAW.app
xcrun notarytool submit path/to/artifact.dmg --wait
xcrun stapler validate path/to/RapidRAW.app
```

Use placeholders only in docs and examples. Never paste real Apple credentials,
private key paths, or certificate passwords into issue comments, PR bodies, logs,
or committed files.

## Evidence To Preserve

Every package or release-hardening PR should record:

- commit SHA and workflow run URL;
- macOS row, target triple, and runner image;
- package artifact names and sizes;
- checksum metadata file names;
- bundle identifier and app version;
- signing identity or explicit unsigned status;
- notarization request identifier or explicit skipped status;
- stapling and Gatekeeper result or explicit skipped status;
- known blockers and follow-up issue links.

## Failure Policy

- Do not publish a stable macOS release when signing, notarization, stapling, or
  Gatekeeper assessment fails.
- Do not treat unsigned artifacts as user-shippable public builds.
- Do not hide release-policy changes inside product feature PRs.
- Do not relax bundle size, minification, signing, or metadata gates in the same
  PR that adds user-visible features.
- If a package dry run fails because of missing credentials, record it as
  skipped/blocked rather than attempting ad hoc local credentials.

## Follow-Up Work

- Resolve RawEngine bundle identifier and app naming policy.
- Add a protected release environment for signing credentials.
- Add release workflow preflight checks for missing signing/notarization inputs.
- Add a signed macOS package verification script that emits compact evidence.
- Add a clean-user or clean-machine Gatekeeper install smoke.
- Reconcile Tauri upload names with checksum metadata before public release.
