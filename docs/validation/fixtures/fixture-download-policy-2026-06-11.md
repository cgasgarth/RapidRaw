# Fixture Download Policy

- Snapshot date: 2026-06-11
- Issue: #66 `validation(fixtures): add fixture download policy`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-fixture-policy`
- Baseline branch: `codex/docs-fixture-download-policy`

## Purpose

RawEngine needs real image fixtures for RAW rendering, color, film simulation,
negative processing, HDR, panorama, focus stacking, super-resolution, AI masks,
and UI validation. This policy defines when fixtures may be downloaded, how they
must be recorded, and what may be committed to the public repository.

## Fixture Classes

Fixtures should be classified before use:

| Class              | Description                                          | Public repo allowed              |
| ------------------ | ---------------------------------------------------- | -------------------------------- |
| `public-small`     | Small redistributable images or metadata fixtures.   | Yes, with license/provenance.    |
| `public-manifest`  | Public files downloaded during validation by URL.    | Manifest only unless approved.   |
| `private-local`    | User-provided or restricted files for local testing. | No file content. Manifest only.  |
| `private-ci`       | Restricted files available only to trusted CI.       | No file content. Manifest only.  |
| `synthetic`        | Generated fixtures with reproducible recipe/code.    | Yes, if recipe and output pass.  |
| `derived-artifact` | Output generated from another fixture or validation. | Only when source license allows. |

Default to `public-manifest` for internet samples until redistribution rights
are confirmed.

## Eligibility Requirements

A fixture may be used only when all of these are known or explicitly marked
unknown:

- Source URL, local acquisition path, or generator recipe.
- Rights and redistribution status.
- Copyright owner or source organization when available.
- File hash after acquisition.
- Intended validation purpose.
- Whether the fixture can be committed publicly, downloaded in public CI, used
  only in private CI, or used only locally.
- Reviewer and review date.

Unknown rights mean the file content must not be committed.

## Download Rules

Fixture downloads must be deterministic and reviewable.

- Download scripts must use explicit URLs, expected hashes, and stable output
  paths.
- Downloads must fail closed on hash mismatch, missing license metadata, or
  unsupported fixture class.
- Downloaded files should live outside source control by default.
- Heavy fixture payloads should not be committed unless the PR explains why the
  file must live in git and documents size impact.
- Scripts must not scrape authenticated services, bypass paywalls, or download
  from sources whose terms prohibit automated access.
- Scripts must not silently replace an existing fixture with different bytes.
- Network downloads should be optional for local checks unless a PR explicitly
  adds a CI gate that requires them.

## Public Repository Rules

The public repository may contain:

- Fixture manifests.
- Small redistributable fixture files with compatible license evidence.
- Synthetic generators and their expected outputs when the output is not derived
  from restricted source material.
- Hashes, dimensions, EXIF summaries, expected warnings, and validation
  thresholds.

The public repository must not contain:

- User private photos.
- Copyrighted sample images without redistribution permission.
- Lab scans or camera RAW files whose terms allow viewing but not
  redistribution.
- Auth tokens, signed URLs, private bucket paths, or machine-local absolute
  source paths.
- Generated artifacts whose source fixture license does not allow publishing
  derivatives.

## Manifest Fields

Each fixture manifest entry should include:

- `fixture_id`
- `class`
- `source_url` or `generator`
- `source_license`
- `redistribution_allowed`
- `public_ci_allowed`
- `private_ci_only`
- `local_only`
- `expected_sha256`
- `expected_size_bytes`
- `media_type`
- `width`
- `height`
- `bit_depth`
- `color_profile`
- `camera_or_scanner`
- `capture_method`
- `validation_purpose`
- `expected_warnings`
- `reviewer`
- `review_date`
- `notes`

Future schema work may move these fields into a Zod-backed manifest schema. Until
then, PRs should keep manifest entries explicit and human-reviewable.

## Negative And Film Fixture Rules

Negative-processing fixtures need extra provenance because acquisition choices
strongly affect conversion quality.

Negative-specific entries should record:

- Acquisition method: camera RAW, camera TIFF, flatbed TIFF, lab TIFF, lab JPEG,
  contact sheet, or unknown.
- Film stock or stock family when known.
- Development process when known.
- Light source and confidence.
- Scanner/camera/lens profile when known.
- Scanner software assumptions when known.
- Whether scanner or lab auto-correction may already be baked in.
- Visible film base, rebate, borders, and frame spacing.
- Known base/fog sample regions and rejected sample regions.
- Expected density, clipping, compression, sharpening, dust, and illumination
  warnings.

Unknown acquisition assumptions must remain visible in validation output and
user-facing limitation reports.

## CI And Local Validation Rules

Fixture-backed checks should be split by cost and rights:

- PR CI: small public or synthetic fixtures only.
- Nightly CI: larger public fixtures and optional download checks.
- Private CI: restricted fixtures with secrets or private storage.
- Local-only: user-owned exploratory samples and one-off debugging images.

CI must print enough evidence to diagnose fixture failures without uploading
restricted images. Prefer hashes, dimensions, metadata summaries, thresholds,
and small allowed crops over full private image artifacts.

## PR Checklist For Fixture Changes

Fixture PRs should include:

- The fixture class for each added or referenced file.
- License/provenance evidence.
- Hashes and expected paths.
- Whether files are committed, downloaded, private-CI-only, or local-only.
- Validation command output.
- Any skipped downloads and the reason.
- Residual risk for rights, stability, or image-quality coverage.

## Current Status

This policy does not add fixture downloads, manifests, CI jobs, or sample image
payloads. Those should be introduced through separate issue-linked PRs after the
manifest format and validation gates are defined.
