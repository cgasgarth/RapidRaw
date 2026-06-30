# RawEngine/RapidRAW User Guide

- Snapshot date: 2026-06-11
- Issue: #254 `docs(user-guide): add user guide`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-user-guide`
- Baseline branch: `codex/docs-user-guide`

## Purpose

This guide explains how to use the current RapidRAW baseline while the RawEngine
fork is being hardened. It is user-facing, but it is deliberately conservative:
it describes workflows that are visible in the current app and calls out roadmap
items separately.

For implementation details, see the
[architecture baseline](../baseline/rapidraw-architecture-baseline-2026-06-11.md),
[sidecar format baseline](../baseline/rapidraw-sidecar-format-baseline-2026-06-11.md),
and [known limitations](../release/process/known-limitations-2026-06-11.md).

## Before You Start

RawEngine is currently macOS-first release-hardening work on top of RapidRAW.
Treat early builds as development builds unless a release explicitly documents
signing, notarization, checksum, and validation status.

Recommended habits:

- Keep your original photos backed up outside the working folder.
- Test a small folder before pointing the app at an important archive.
- Keep sidecar files with their source images when copying, moving, renaming, or
  backing up edited files.
- Prefer non-sensitive sample files when reporting bugs.
- Record the app commit, build, platform, and exact steps when testing early
  builds.

## Library And Import Basics

RapidRAW works primarily from folders rather than from a separate catalog
database.

- Open or add photo folders from the library view.
- Use the folder tree, recursive folder view, flat list mode, albums, filtering,
  sorting, and search to navigate large folders.
- The library can show thumbnails, EXIF summaries, ratings, labels, and tags as
  available.
- Import and file-management actions are backed by the Rust/Tauri layer, which
  also updates thumbnails and sidecars.
- Android content URI and mobile import behavior exists in the inherited
  RapidRAW codebase, but RawEngine's required validation is currently
  macOS-focused.

When you import or duplicate files, verify that the expected image files and
sidecars are present afterward. Early validation has not yet replaced careful
user review for every file-management edge case.

## Non-Destructive Editing

RapidRAW's core editing model is non-destructive. Normal tone, color, geometry,
mask, LUT, lens, and effect edits are saved as metadata and replayed when the
image is previewed or exported.

Typical workflow:

1. Select an image from the library or filmstrip.
2. Adjust exposure, contrast, highlights, shadows, color, curves, crop,
   rotation, lens correction, detail, effects, masks, or presets.
3. Let the app update the live preview.
4. Export a rendered output when you need a shareable image file.

The original source image is not the rendered edit. The source plus its sidecar
is the editable unit. If you move only the source image without its sidecar, the
edit state may not move with it.

## Sidecars And Virtual Copies

RapidRAW stores per-image edit state in `.rrdata` JSON sidecar files next to the
source image.

For a physical image:

```text
/photos/IMG_0001.CR3
```

the primary sidecar is:

```text
/photos/IMG_0001.CR3.rrdata
```

Virtual copies are separate edit versions of the same source file. They are
represented by a virtual path internally, such as:

```text
/photos/IMG_0001.CR3?vc=abc123
```

and by a separate sidecar next to the source image:

```text
/photos/IMG_0001.CR3.abc123.rrdata
```

Practical rules:

- Keep `.rrdata` files with the image files they describe.
- Back up both original files and sidecars.
- Treat virtual copies as sidecar-backed variants, not duplicate source images.
- Be careful when syncing folders with tools that hide, ignore, or delete
  unknown sidecar files.
- Do not manually edit sidecars unless you are prepared to recover from a backup.

Current sidecar writes are whole-file JSON writes. They do not yet have the
future RawEngine catalog, merge-token, or conflict-detection behavior described
in the broader roadmap.

## Metadata, Ratings, Labels, And Tags

RapidRAW can store and display organizational metadata for library work.

Current behavior:

- Star ratings are stored in the sidecar.
- Color labels are stored as `color:` tags in the sidecar.
- User tags are stored as `user:` tags.
- AI-generated tags are stored as plain tags.
- EXIF data can be read, cached, and shown in the app.
- XMP sync exists for ratings, labels, and tags when enabled in settings.

Important caveats:

- XMP sync is compatibility sync, not a full export of all edit settings.
- Adjustments are not written to XMP.
- XMP behavior is physical-file scoped, which can be ambiguous for virtual
  copies.
- EXIF field edits are currently physical-image scoped in the observed UI flow.
- Metadata operations should be tested on copies before being trusted with a
  large archive.

If another app edits XMP or sidecars while RapidRAW is open, reload and verify
the visible metadata before doing bulk edits.

## Export Expectations

Exports render the current source image plus sidecar adjustments into new output
files.

Current export capabilities visible in the baseline include batch export,
format/encoding choices, resizing, watermarking, metadata preservation options,
mask export, LUT export, progress events, completion events, errors, and
cancellation.

Practical export guidance:

- Export to a separate output folder when testing.
- Confirm the output format, size, metadata option, naming scheme, and overwrite
  behavior before running a batch.
- Inspect a few exported files before deleting or archiving the working folder.
- Keep the source image and sidecar if you want to make later edits.

Roadmap items such as richer export recipes, a stronger batch queue, first-class
derived artifact provenance, and app-server export tools should be treated as
future RawEngine work until their implementing PRs and validation evidence are
linked.

## AI And Agent Caveats

RapidRAW already has several AI-related hooks, including local AI masks,
inpainting, denoise, CLIP-backed tagging, and generative replace through either a
cloud path or an external AI connector path depending on settings and
availability.

Use AI features carefully:

- Model downloads, GPU capability, provider settings, and connector status can
  affect availability and performance.
- Cloud or connector-based generative edits may involve external services or
  local services outside the app process.
- Do not send private or sensitive images to a cloud provider unless the release
  and privacy policy explicitly match your requirements.
- Review generated patches, masks, and tags before accepting them into an
  important workflow.
- Keep originals and sidecars backed up before batch AI operations.

The RawEngine plan includes a future OpenAI app-server based expert editing
agent. That agent is roadmap work. It should not be assumed present in current
builds unless a later release documents app-server tools, approval gates,
provenance logging, replay validation, and prompt-injection safety checks.

## Current Limitations

The most important current limitations are summarized in the
[known limitations page](../release/process/known-limitations-2026-06-11.md).

In short:

- Required validation is currently macOS-first.
- Release signing, notarization, and update distribution are still being
  hardened.
- Browser-only screenshots are not a reliable substitute for Tauri app
  validation.
- The sidecar model is file-path based, not a full RawEngine catalog database.
- Current adjustment payloads are flexible JSON, not yet the planned shared
  typed command schema.
- High-risk roadmap areas such as professional color science, full layers,
  Negative Lab, HDR, panorama, focus stacking, super-resolution, and app-server
  agent editing require dedicated ADRs, schemas, fixtures, and validation gates
  before they should be treated as complete RawEngine features.

## Validation Expectations For Early Builds

When testing early builds, record evidence as if you were helping validate a
release candidate.

Useful evidence includes:

- App commit SHA or release version.
- macOS version, hardware model, CPU/GPU, and memory.
- Source file type, camera model, lens, and whether the file is safe to share.
- Exact folder/library steps.
- Exact edit steps and export settings.
- Screenshots or screen recordings for UI issues.
- Before/after exported artifacts for render issues.
- Sidecar snippets only if they do not expose private data.
- Console or app logs when available.

For docs-only repository changes, the local docs gate is:

```sh
PATH=/Users/cgas/Documents/RawEngine/RapidRaw/node_modules/.bin:$PATH bun run docs:check
git diff --check
```

Feature, rendering, AI, export, and file-management changes usually need
stronger validation than this guide requires.

## Reporting Issues

Use GitHub issues for bugs and feature requests in `cgasgarth/RapidRaw`.

For bugs, include:

- What happened.
- What you expected.
- Reproduction steps.
- Operating system and hardware.
- RapidRAW/RawEngine version or commit SHA.
- Whether the issue involves library navigation, metadata, sidecars, rendering,
  export, AI, release packaging, or app startup.
- Validation evidence such as logs, screenshots, sample-file details, or render
  artifacts.

Before filing camera or lens support issues, check the linked upstream support
resources in the repository issue template. RapidRAW relies on external raw
decoding and lens-correction libraries for those compatibility surfaces.

For security-sensitive issues, follow `SECURITY.md`: do not open a public issue
with exploit details, private image files, credentials, or sensitive logs.

## Roadmap Guidance

The RawEngine roadmap is broader than the current baseline. It includes a typed
editing API, stronger command replay, catalog-like workflows, richer export
recipes, full validation fixtures, high-risk computational photography gates,
and app-server agent tooling.

Until those items land:

- Treat the current app as a capable RapidRAW baseline under RawEngine
  hardening.
- Treat roadmap items as planned work, not guaranteed current behavior.
- Prefer small, evidence-backed bug reports and feature requests.
- Keep the plan, linked issues, validation evidence, and limitations page aligned
  when product scope changes.
