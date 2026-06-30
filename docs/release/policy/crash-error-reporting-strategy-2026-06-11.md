# Crash And Error Reporting Strategy

- Date: 2026-06-11
- Issue: #246 `release(crash): add crash and error reporting strategy`
- Scope: release-hardening strategy only; no crash-reporting provider is enabled in this PR.

## Purpose

RawEngine needs useful diagnostics without surprising users or leaking private
photo data. This strategy defines the path from the inherited RapidRAW local log
baseline to a release-ready crash and error reporting system.

Crash reporting must remain privacy-first. A crash pipeline that helps debugging
but silently uploads filenames, source paths, prompts, pixels, metadata, or
sidecar contents is not acceptable.

## Current Baseline

Current app behavior visible in the fork:

- The frontend log bridge forwards console logs, window errors, unhandled
  promise rejections, and development Vite error details to the Tauri backend
  through `Invokes.FrontendLog`.
- Frontend log messages are length-limited, depth-limited, circular-safe, and
  deduplicated over a short window.
- Settings expose a local "View Application Logs" surface and a log path status
  message in localized strings.
- RAW image development is wrapped in `panic::catch_unwind` so some decoder
  panics become logged errors instead of process crashes.
- GPU initialization writes and clears a crash flag around WGPU setup.
- The app has user-facing graphics backend guidance because changing backend can
  avoid crashes on some systems.

Current gaps:

- No public crash-reporting provider is selected.
- No telemetry opt-in decision is complete.
- No redaction policy is enforced for diagnostics.
- No automatic upload path is documented or implemented.
- No crash-report bundle command exists.
- No CI validation proves logs exclude secrets, source pixels, prompts, or
  private metadata.

## Principles

- Local diagnostics first: logs should be useful without a network dependency.
- Opt-in upload only: crash reports, diagnostics, telemetry, and usage data are
  not sent automatically unless a later product decision explicitly enables that
  with user consent.
- Redaction before collection: sensitive fields should be removed before reports
  are written, displayed, copied, or uploaded.
- Minimal reproduction data: reports should prefer error codes, versions, stack
  classes, feature flags, hardware class, and command IDs over raw user data.
- No source pixels by default: source images, previews, masks, sidecars, and
  exports are excluded unless a user explicitly attaches them.
- Agent and AI activity is sensitive: prompts, provider responses, model inputs,
  masks, and generated artifacts require explicit inclusion and redaction.
- Crash reporting must never weaken validation or become a substitute for
  deterministic tests.

## Diagnostic Data Classes

| Data class               | Default policy                                                              |
| ------------------------ | --------------------------------------------------------------------------- |
| App version and commit   | Safe to include.                                                            |
| OS and architecture      | Safe to include at coarse granularity.                                      |
| GPU/backend class        | Safe to include without full device serials or unique IDs.                  |
| Rust panic class         | Include message category and stack where redacted.                          |
| Frontend stack           | Include function/file references after path redaction.                      |
| File paths               | Redact home/user-specific prefixes by default.                              |
| Source image bytes       | Exclude by default.                                                         |
| Preview or mask pixels   | Exclude by default unless user explicitly attaches.                         |
| `.rrdata` sidecars       | Exclude by default; provide sanitized summaries only.                       |
| EXIF/IPTC/XMP metadata   | Exclude raw values by default; include only explicit user-approved samples. |
| Agent prompts/tool calls | Exclude by default; include redacted command IDs and approval states first. |
| Provider/API keys        | Always redact.                                                              |
| Logs                     | Include only after redaction and user review.                               |

## Local Error Bundle

Future release builds should provide a user-invoked diagnostic export. The
bundle should be deterministic enough for support while avoiding sensitive
payloads.

Suggested contents:

- app version, commit SHA, build type, and platform;
- OS version, CPU architecture, memory class, and GPU/backend summary;
- settings relevant to the failure, with secrets and paths redacted;
- recent redacted app logs;
- crash flag state and last startup/shutdown state;
- command IDs, graph revision IDs, and feature flags involved in the failure;
- dependency status for optional providers such as AI backends;
- validation warnings relevant to the failure;
- instructions for optionally attaching source files or sidecars manually.

The bundle should not include source images, full sidecars, exports, prompts,
provider responses, or full absolute paths without explicit user choice.

## Provider Decision

No provider is selected yet. Before enabling any provider, open a provider
decision PR that answers:

1. Does RawEngine need automated crash upload for the current release stage?
2. Is upload opt-in, opt-out, or disabled by default?
3. Which provider is used, and what data is sent?
4. Where are symbols, source maps, and debug artifacts stored?
5. How are retention, deletion, and access controls configured?
6. How are AGPL/source distribution obligations handled for hosted behavior?
7. How can a user inspect, redact, and opt out before sending data?
8. How is the provider disabled in local development and CI?

Provider candidates should be evaluated against local-only reporting first. A
simple "copy diagnostic bundle" flow may be enough until RawEngine has a public
support channel and privacy-reviewed release process.

## Error Taxonomy

Crash and error reporting should classify failures before upload or display:

- startup failure
- GPU initialization failure
- RAW decode failure
- image render failure
- sidecar read/write failure
- metadata write failure
- export failure
- AI/provider unavailable
- app-server tool validation failure
- command replay/revision conflict
- filesystem permission failure
- dependency/security policy failure

Each class should have a stable code, user-facing summary, internal diagnostic
fields, retryability, and privacy sensitivity rating.

## App-Server And AI Reporting

Agent and AI failures require stronger reporting boundaries:

- Tool-call logs should record command IDs and schema validation errors before
  storing prompt text.
- Prompt text, provider responses, OCR text, captions, metadata, filenames, and
  sidecar text are untrusted and private by default.
- Cloud provider failures should include provider class and status code category,
  not secrets, full endpoint URLs, or payloads.
- Failed AI outputs should record provenance status and artifact IDs, not raw
  generated images, unless the user attaches them.
- Approval denials and cancellations are normal outcomes, not crashes.

## Validation Requirements

Future implementation PRs should add tests for:

- frontend log serialization truncates and deduplicates without recursion;
- secret-like values are redacted from local bundles;
- home-directory and source-image paths are redacted;
- sidecar and metadata summaries do not include raw private fields by default;
- crash bundles exclude source pixels and preview artifacts unless explicitly
  included;
- RAW decode panic handling produces a classified error;
- GPU crash flag lifecycle is testable;
- agent/tool logs do not treat untrusted metadata as instructions;
- provider-unavailable paths produce actionable diagnostics without upload;
- upload is disabled by default until the release privacy decision is complete.

## Release Checklist

Before production release:

- privacy policy covers diagnostics and crash reporting;
- telemetry opt-in decision is complete;
- crash provider decision is complete, or automated upload is explicitly
  disabled;
- local diagnostic bundle command exists;
- user can inspect and redact diagnostic data before sharing;
- redaction tests exist;
- source maps and symbols are handled safely if external reporting is enabled;
- release notes disclose diagnostics behavior.

## Follow-Up Issues

- `release(telemetry): decide telemetry opt-in`
- `release(privacy): add privacy policy`
- `diagnostics(bundle): add local diagnostic export`
- `diagnostics(redaction): add path secret metadata and prompt redaction tests`
- `diagnostics(provider): decide crash reporting provider or local-only policy`
- `validation(crash): add RAW decode panic and GPU crash flag tests`
