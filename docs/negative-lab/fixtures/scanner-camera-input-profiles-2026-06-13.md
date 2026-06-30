# Negative Lab Scanner And Camera Input Profiles

- Date: 2026-06-13
- Issue: #158 `negative-lab(profiles): add scanner and camera-scan profile inputs`
- Status: proposed
- Scope: schema and sample catalog for scanner, camera-scan, camera RAW, and
  lab-rendered input profile choices. This does not add pixel conversion code or
  profile UI yet.
- Depends on:
  [input profile strategy ADR](../architecture/input-profile-strategy-adr-2026-06-13.md).

## Purpose

Negative Lab needs a typed way to describe how source scans enter the density
pipeline. Acquisition profiles describe what was detected from a file or roll;
input profile catalog entries describe the selectable or inferred profile lanes
that the UI, command API, and app-server tools can reference.

The v1 catalog separates:

- camera RAW negative captures;
- linear camera-scanned TIFF negatives;
- scanner TIFF negatives;
- low-confidence lab JPEG review inputs.

## Included Contract

The schema adds:

- `NegativeLabInputProfileCatalogV1`
- `NegativeLabInputProfileV1`
- `NegativeLabInputProfileKindV1`
- `NegativeLabInputProfileSourceV1`

The generated sample artifact is:

- `packages/rawengine-schema/samples/negative-lab-input-profile-catalog-v1.json`

## Validation Rules

The schema rejects:

- duplicate profile IDs;
- duplicate display names;
- default input modes not present in supported input modes;
- camera RAW profiles that do not default to `camera_raw`;
- camera RAW profiles that are display-referred;
- lab-rendered profiles without `lossy_input` and
  `low_acquisition_confidence` warnings;
- high-confidence profiles whose source is only an assumed display profile or
  unknown.

## API And UI Expectations

Future UI and app-server tools should use this catalog to present input-profile
choices before conversion. The selected profile should flow into acquisition
health, base sampling, conversion planning, warning copy, and dry-run summaries.

Lab JPEG entries remain review-oriented. They can help users inspect legacy lab
scans, but they should not be treated as high-confidence input for automated
profile measurement or exact stock work.

## Deferred

Separate PRs should add:

- UI selection controls;
- sidecar persistence for selected input profile IDs;
- profile import validation for user ICC/DCP files;
- app-server resolver tools;
- pixel pipeline integration;
- fixture-backed camera/scanner profile checks.
