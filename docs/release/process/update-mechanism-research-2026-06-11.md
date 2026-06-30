# Update Mechanism Research

- Snapshot date: 2026-06-11
- Issue: #251 `release(update): research update mechanism`
- Repository: `cgasgarth/RapidRaw`
- Local checkout:
  `/Users/cgas/Documents/RawEngine/RapidRaw-release-update-mechanism`
- Branch: `codex/release-update-mechanism`

## Purpose

This document records the first RawEngine update-mechanism decision point for
the RapidRAW fork. It does not enable auto-updates yet. The goal is to define
the safest path for a future macOS-first public release without adding update
infrastructure before signing, notarization, artifact provenance, and release
metadata are stable.

Primary source checked:

- [Tauri v2 updater plugin](https://v2.tauri.app/plugin/updater/)
- [Tauri macOS code signing guide](https://v2.tauri.app/distribute/sign/macos/)

## Current Recommendation

Use Tauri's v2 updater plugin only after the release workflow can produce:

- signed and notarized macOS app artifacts;
- updater artifacts with detached signatures;
- checksum and SBOM metadata;
- a reviewed `latest.json` or equivalent dynamic update response;
- release notes that describe privacy, security, and compatibility changes;
- rollback instructions and key-rotation runbooks.

Until then, RawEngine should publish manual unsigned or signed development
artifacts only through the documented release workflow and known-limitations
page.

## Why Not Enable It Immediately

Auto-update raises the blast radius of a bad release. The updater trust chain
depends on signing keys, endpoint integrity, artifact signatures, and accurate
platform metadata. If any of those are immature, the update channel can become
less safe than manual downloads.

The updater should therefore be treated as release infrastructure, not a
frontend convenience feature.

## Tauri v2 Updater Requirements

Tauri's updater supports a static JSON endpoint or a dynamic update server. For
RawEngine's macOS-first path, the minimum viable setup is:

- add the Tauri updater plugin in Rust and JavaScript only when release signing
  is ready;
- configure `bundle.createUpdaterArtifacts`;
- configure the updater `pubkey` in Tauri config;
- publish HTTPS updater endpoints;
- generate updater bundle signatures during release builds;
- ship the update manifest with version, platform URL, and signature fields.

The updater documentation states that update signatures are required. The
private signing key must remain secret, while the public key is configured in
the app so installed builds can verify future update artifacts.

## Static JSON Channel Shape

The first update channel should be a static JSON file attached to GitHub
Releases or stored behind another HTTPS static host. A dynamic update server can
wait until RawEngine needs staged rollouts, channel targeting, or authenticated
license-aware delivery.

Required static-channel fields:

| Field                                   | Requirement                                                               |
| --------------------------------------- | ------------------------------------------------------------------------- |
| `version`                               | SemVer-compatible release version.                                        |
| `platforms["darwin-aarch64"].url`       | HTTPS URL for the macOS Apple Silicon updater artifact.                   |
| `platforms["darwin-aarch64"].signature` | Contents of the generated `.sig` file, not a URL.                         |
| `notes`                                 | Human-readable release notes, preferably generated from merged PR labels. |
| `pub_date`                              | RFC 3339 timestamp when present.                                          |

Intel macOS can be added later if RawEngine decides to support it as a release
target.

## Key Handling

Update signing keys should be separate from Apple Developer signing identities.

- Store the updater private key only in GitHub Actions secrets or an equivalent
  secret manager.
- Do not commit the private key or encrypted private-key material to the repo.
- Record the public key in Tauri config only when the update channel is ready.
- Document key rotation before enabling the updater for users.
- Treat private-key loss as a serious release incident because existing installs
  would no longer trust newly signed update artifacts.

## Release Workflow Placement

The update mechanism should run after these gates:

1. CI quality gates pass.
2. macOS build completes.
3. Apple code signing completes.
4. Notarization and stapling complete.
5. Checksums and SBOM are generated.
6. Updater artifacts and signatures are generated.
7. Release notes are generated and reviewed.
8. `latest.json` is generated from the final artifact URLs and signatures.
9. A dry-run verifier fetches `latest.json`, validates JSON shape, verifies
   artifact URLs are reachable, and confirms signatures are present.

## Validation Plan

Before enabling auto-updates in a release build, add checks for:

- updater manifest JSON schema;
- SemVer and channel naming;
- artifact URL reachability;
- SHA-256 checksum presence for every artifact;
- updater signature presence for every updater artifact;
- public-key presence in Tauri config;
- private-key absence from repository files and logs;
- release notes presence;
- rollback notes presence.

## Follow-Up Work

- Add release notes automation before generating update manifests.
- Add signing and notarization workflow before public updater artifacts.
- Add a dry-run updater manifest verifier.
- Add a release-channel policy for `dev`, `beta`, and `stable`.
- Decide whether update publishing remains GitHub Releases static JSON or moves
  to a dynamic server.
