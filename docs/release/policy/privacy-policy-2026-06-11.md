# RawEngine Privacy Policy Draft

- Date: 2026-06-11
- Issue: #247 `release(privacy): add privacy policy`
- Scope: release-hardening privacy policy draft for the public RawEngine/RapidRaw fork.

## Purpose

This document defines the privacy posture RawEngine should hold before public
release artifacts are treated as shippable. It is a project policy draft and
implementation checklist, not legal advice and not a claim that every future
feature is already implemented.

RawEngine is a macOS-first local RAW editor built from the RapidRAW fork. The
default privacy position is simple: editing should happen locally, originals
should remain under the user's control, and network or cloud behavior must be
explicit, reviewable, and approval-gated.

## Current Baseline

Current release state:

- The app is still in development and should be treated as a baseline artifact.
- Release signing, notarization, crash reporting, telemetry, update checks, and
  public distribution policy are not complete.
- Planned OpenAI app-server agent work and migration of inherited AI tools are
  not complete.
- Public fixture and sample-image policy is still being hardened.

Related docs:

- [Known limitations](../process/known-limitations-2026-06-11.md)
- [macOS signing and notarization placeholders](../macos/macos-signing-notarization-placeholders-2026-06-11.md)
- [deferred Rust advisories](../../security/deferred-rust-advisories.md)

## Privacy Principles

- Local first: RAW decoding, editing, sidecar writes, previews, and exports
  should run locally unless a feature explicitly says otherwise.
- Originals are immutable: RawEngine must not modify source RAW files.
- Sidecars are user data: `.rrdata`, XMP/IPTC/EXIF outputs, catalogs, caches,
  previews, export recipes, and agent logs can contain sensitive photo,
  location, device, and workflow data.
- No silent telemetry: analytics, crash reporting, update checks, or usage
  reporting require an explicit product decision and user-facing disclosure
  before release.
- No silent cloud processing: external model calls, hosted AI, cloud storage,
  connector use, or app-server network exposure require explicit consent and
  provenance.
- Minimize retained data: caches and logs should avoid storing source pixels,
  secrets, unredacted prompts, or unnecessary metadata.
- Make privacy visible: UI, API responses, app-server tool outputs, validation
  reports, and release notes should show when pixels or metadata may leave the
  machine.

## User Data Classes

| Data class              | Examples                                                        | Default handling                                                |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Source assets           | RAW, DNG, TIFF, JPEG, HEIC, video frames used for extraction    | Never modify in place. Never upload without explicit consent.   |
| Sidecars and edit graph | `.rrdata`, future graph state, command history, virtual copies  | User-owned local data; migration must be versioned and tested.  |
| Metadata                | EXIF, XMP, IPTC, ratings, labels, tags, filenames, folders      | Treat as sensitive and potentially untrusted input.             |
| Derived artifacts       | Exports, previews, HDR, panorama, focus stack, super-resolution | Store provenance and no-overwrite behavior.                     |
| AI and agent records    | prompts, tool calls, approvals, model provenance, output hashes | Redact where practical; record consent and provider class.      |
| Validation fixtures     | public sample images, generated fixtures, golden artifacts      | Require source, license, hash, intended use, and privacy notes. |
| Diagnostics             | logs, crash reports, performance traces, workflow summaries     | Opt-in before collection; avoid source pixels and secrets.      |

## Local Storage Policy

RawEngine may create local files while editing:

- sidecars next to source images or in a future catalog location;
- preview and thumbnail caches;
- temporary render artifacts;
- export outputs;
- future command replay and agent audit logs;
- future fixture or validation caches.

Requirements:

- Sidecar writes should be atomic and recoverable.
- Cache locations should be documented and clearable.
- Temporary files should not outlive their purpose unless they are promoted to a
  named artifact.
- Export overwrite must require explicit policy and validation.
- Logs and validation artifacts should avoid embedding raw source pixels unless a
  fixture policy explicitly allows it.

## Network And Cloud Policy

Network behavior must be explicit. A future release policy should list every
network surface before the app is advertised as production-ready.

Potential network surfaces:

- app update checks;
- crash reporting;
- telemetry or analytics;
- OpenAI app-server or model-provider integration;
- self-hosted AI providers;
- cloud AI providers;
- fixture downloads;
- documentation links opened by the user;
- package-manager or development-time dependency fetches.

Rules:

- No production telemetry is enabled without a dedicated opt-in decision.
- No source pixels, previews, masks, prompts, metadata, or sidecars are sent to a
  cloud service without scoped user approval.
- External model calls must show provider class, data sent, estimated scope,
  fallback behavior, and whether the output becomes part of the edit graph.
- App-server tools must not expose raw Tauri commands, shell access, or UI
  automation as editing shortcuts.
- Connector-backed or hosted features must keep API keys out of logs, sidecars,
  artifacts, screenshots, and validation reports.

## AI And Agent Privacy

RawEngine's planned app-server agent is high value and high risk. Its privacy
boundary must be designed before user-facing release.

Agent requirements:

- Read-only inspection tools may inspect metadata, previews, histograms, scopes,
  edit graph state, and provenance only through typed APIs.
- Mutating tools require dry-run output and approval when they change sidecars,
  edit graphs, exports, files, or derived artifacts.
- Cloud AI calls require explicit disclosure and consent before pixels, masks,
  prompts, previews, or metadata leave the machine.
- AI outputs that affect edits must record provider, model/version when known,
  prompt/tool input where appropriate, source hash, output hash, approval state,
  and fallback behavior.
- Prompt-injection defenses must treat EXIF, XMP, IPTC, tags, filenames,
  sidecars, captions, OCR, generated descriptions, and provider responses as
  untrusted data.
- Agent logs should be reviewable by the user and should not retain unnecessary
  sensitive content.

## Fixture And Sample Data Privacy

Validation fixtures are part of the privacy surface because real photos can
contain faces, locations, serial numbers, addresses, copyrighted content, and
private context.

Before real fixtures are committed, cached, or downloaded:

- record source URL or generation process;
- record license and allowed use;
- record cryptographic hash;
- record storage class: repo, Git LFS, external download, or local-only;
- record intended validation use;
- record privacy/legal notes;
- exclude private photos unless explicit written permission and storage policy
  exist.

Synthetic fixtures are preferred for early schema, sidecar, command, and
agent-tool validation.

## Metadata Safety

Metadata writes are high risk because they can alter files or create externally
visible records.

Rules:

- RawEngine-native state should prefer sidecars over in-place source mutation.
- XMP/IPTC/EXIF writes need a separate metadata policy before production use.
- Batch metadata changes require dry-run, selected-scope summary, approval, and
  rollback or recovery behavior where practical.
- Agent-driven metadata writes require approval and provenance.
- Imported metadata must be treated as untrusted text and must not steer tools
  without user approval.

## User Controls To Add Before Release

Release-blocking controls to define or implement:

- clear cache and temporary artifacts;
- inspect sidecar and catalog storage locations;
- disable network features;
- opt in or out of crash reporting;
- opt in or out of telemetry if telemetry is ever added;
- approve or deny cloud AI calls;
- review AI/provider provenance;
- export or delete agent audit logs;
- review fixture download policy for validation builds;
- show privacy-impact warnings for batch file, metadata, export, and cloud
  operations.

## Validation Requirements

Privacy-sensitive changes should include validation evidence.

Required future gates:

- no-original-overwrite tests;
- sidecar atomic write and rollback tests;
- metadata write dry-run tests;
- export collision and overwrite tests;
- cloud/provider approval tests;
- app-server tool approval tests;
- prompt-injection fixtures for metadata, filenames, sidecars, and provider
  responses;
- fixture manifest source/license/hash/privacy checks;
- log redaction tests for secrets, file paths where configured, prompts, and
  provider tokens;
- cache cleanup tests for temporary artifacts.

Until those gates exist, privacy-related PRs should list the closest available
local checks and state residual risk explicitly.

## Release Checklist

Before a public production release, RawEngine should have:

- user-facing privacy policy reviewed for the actual shipped feature set;
- documented network surfaces and default states;
- documented storage locations;
- telemetry and crash reporting decision;
- update-check decision;
- fixture privacy policy and manifest checks;
- AI/provider approval and provenance policy;
- app-server privacy and prompt-injection validation;
- metadata write policy;
- cache cleanup behavior;
- release notes that call out privacy-impacting limitations.

## Open Follow-Ups

- `release(telemetry): decide telemetry opt-in`
- `release(crash): add crash and error reporting strategy`
- `safety(metadata): define XMP IPTC EXIF write policy`
- `validation(fixtures): add external download cache policy`
- `validation(agent): add prompt injection fixtures`
- `ai(approval): require approval for cloud AI and generative edits`
- `ai(provenance): record model backend and settings in sidecars`
