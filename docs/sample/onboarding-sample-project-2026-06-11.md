# Onboarding Sample Project

- Snapshot date: 2026-06-11
- Issue: #245 `docs(sample): add onboarding sample project`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-onboarding-sample`
- Branch: `codex/docs-onboarding-sample`

## Purpose

This document defines the first RawEngine onboarding sample project shape. It
does not add sample photos to the repository. Instead, it gives contributors a
stable folder layout, manifest template, and validation checklist for building a
legal sample project from public, project-owned, or generated fixtures later.

## Sample Project Goals

The onboarding project should let a new contributor or reviewer exercise the
core app workflow without needing a personal photo library:

- import a small folder of images;
- open RAW and rendered images where licensing allows;
- review thumbnails, metadata, ratings, color labels, and tags;
- apply basic edits and verify sidecar behavior;
- inspect one AI/tagging or mask-ready fixture only when model and privacy
  requirements are satisfied;
- export a derived image into a separate output folder;
- compare expected files against the manifest.

## Repository Shape

The sample project should live outside the source tree by default. A future
download script can materialize it under `.rawengine-samples/onboarding/`.

```text
.rawengine-samples/onboarding/
  README.md
  manifest.json
  originals/
    raw/
    rendered/
  sidecars/
  exports/
  expected/
    sidecars/
    thumbnails/
    exports/
  evidence/
    screenshots/
    validation-logs/
```

## Manifest Requirements

Every sample asset must have a manifest record before it is used in tests,
screenshots, or docs.

| Field          | Requirement                                                       |
| -------------- | ----------------------------------------------------------------- |
| `id`           | Stable lowercase identifier for scripts and docs.                 |
| `kind`         | `raw`, `rendered`, `sidecar`, `export`, `screenshot`, or `log`.   |
| `storageClass` | `external-public`, `generated`, `project-owned`, or `local-only`. |
| `sourceUrl`    | Original source URL when externally sourced.                      |
| `license`      | License name or `project-owned`; never leave unknown.             |
| `licenseUrl`   | URL for license terms or source page evidence.                    |
| `sha256`       | Hash of the exact file used locally.                              |
| `bytes`        | File size in bytes.                                               |
| `intendedUse`  | Workflow this asset validates.                                    |
| `privacyNotes` | Notes for people, location, EXIF, or sensitive content.           |

## Starter Workflow

1. Create the folder structure under `.rawengine-samples/onboarding/`.
2. Add two to six small legal sample images or generated fixtures.
3. Record each source, license, hash, and intended use in `manifest.json`.
4. Open the folder in RapidRAW.
5. Rate, label, tag, and edit one image.
6. Confirm sidecars are written outside the source original.
7. Export one edited image to `exports/`.
8. Save screenshots and validation logs under `evidence/`.
9. Update the manifest with all generated evidence hashes.

## Validation Checklist

- Originals are never modified.
- Sidecars are deterministic enough for review after expected volatile fields are
  excluded.
- Exported images are written into the sample output folder.
- Manifest entries include source, license, hash, size, intended use, and privacy
  notes.
- No sample image is committed to the repo unless redistribution rights and file
  size policy allow it.
- Any external download script must fail closed when hashes or license metadata
  do not match.

## Follow-Up Implementation

Future PRs can build on this guide by adding:

- a manifest linter for onboarding sample projects;
- a download/materialization script that reads the manifest;
- generated placeholder fixtures for docs screenshots;
- a local browser or app screenshot checklist;
- a small fixture corpus once source and license evidence are approved.
