# Telemetry Opt-In Decision

- Date: 2026-06-11
- Issue: #248 `release(telemetry): decide telemetry opt-in`
- Scope: release policy decision only; no telemetry implementation is added in this PR.

## Decision

RawEngine should ship with product telemetry disabled by default.

No usage analytics, crash uploads, feature tracking, editing-history summaries,
image metadata, prompts, model-provider details, source paths, or derived
artifacts should be sent to RawEngine maintainers or third-party services unless
a later PR implements an explicit opt-in flow with disclosure, controls,
redaction, and validation.

This decision does not remove user-initiated network features such as opening
documentation links or future approved cloud AI calls. Those features need their
own consent and provenance paths.

## Current Baseline Notes

The repository currently uses the word "analytics" in multiple ways:

- Histogram/waveform analytics are local image-analysis workers, not product
  telemetry.
- Settings and AI panels can fetch cloud-AI monthly usage from
  `https://getrapidraw.com/api/usage` when inherited cloud AI account state is
  used.
- App logs are local diagnostics unless a future reporting provider uploads
  them.
- Crash reporting strategy is tracked separately and should also default to
  local-first, opt-in sharing.

Future docs and UI should avoid ambiguity by reserving:

- "image analysis" for histograms, scopes, waveform, and render-derived
  measurements;
- "usage quota" for cloud AI account limits;
- "telemetry" for product analytics sent outside the local machine.

## Allowed Without Telemetry Opt-In

These are acceptable without product telemetry consent:

- local histogram, waveform, scopes, and preview analysis;
- local logs stored on the user's machine;
- local validation commands and CI checks;
- user-initiated export of diagnostic bundles;
- user-initiated opening of documentation or source links;
- package-manager downloads during development;
- explicit cloud AI calls after the user has approved that provider and payload.

## Not Allowed Without Explicit Opt-In

Do not send these automatically:

- app launch events;
- feature-use events;
- edit command history;
- file paths, folder names, project names, or album names;
- EXIF, XMP, IPTC, ratings, tags, captions, or sidecar contents;
- source pixels, previews, masks, thumbnails, exports, or generated artifacts;
- app-server prompts, tool calls, provider responses, or approval logs;
- crash reports, stack traces, or local logs;
- hardware identifiers beyond what a user explicitly includes in diagnostics.

## Requirements For Any Future Telemetry PR

A future telemetry implementation must include:

- opt-in disabled by default;
- plain-language disclosure before enablement;
- separate controls for telemetry, crash reports, cloud AI, and diagnostic
  bundles;
- visible list of event names and fields;
- no source pixels, sidecars, prompts, metadata, or file paths by default;
- redaction tests for secrets, paths, prompts, metadata, provider tokens, and
  image-derived data;
- data retention and deletion policy;
- offline behavior when telemetry is disabled or unavailable;
- CI validation that telemetry code is inert when disabled;
- release notes documenting the shipped behavior.

## Event Design Constraints

If telemetry is later approved, events should be coarse and low-cardinality.

Acceptable examples after opt-in:

- app version and platform class;
- feature flag enabled or disabled;
- command family count without parameters;
- error code class without private payload;
- performance bucket such as preview render latency range;
- provider class such as local, self-hosted, or cloud without endpoint or key.

Rejected examples:

- exact filenames or folder paths;
- camera serial numbers;
- GPS coordinates;
- user prompts;
- raw command parameters;
- edit graph details;
- AI masks or generated outputs;
- arbitrary exception messages before redaction.

## Validation Requirements

Telemetry-related PRs should add tests for:

- disabled-by-default behavior;
- settings persistence for opt-in/out;
- no network call when telemetry is disabled;
- event schema allowlist;
- redaction before persistence or upload;
- crash-report and telemetry setting separation;
- cloud AI consent separation;
- local diagnostic export still works without telemetry;
- CI failure when a new event lacks schema and privacy review.

## Follow-Up Issues

- `release(crash): add crash and error reporting strategy`
- `release(privacy): add privacy policy`
- `telemetry(schema): add event allowlist if telemetry is ever implemented`
- `telemetry(settings): add opt-in controls if telemetry is ever implemented`
- `telemetry(validation): prove disabled telemetry performs no network calls`
