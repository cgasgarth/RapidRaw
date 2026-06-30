# Negative Lab Measured-Profile Fixture Format

- Date: 2026-06-13
- Issue: #275 `negative-lab(presets): add measured-profile fixture format`
- Status: proposed
- Scope: docs-only first pass for a measured Negative Lab film/process profile
  fixture record. This does not add schemas, samples, runtime code, or CI
  wiring.
- Depends on:
  [Negative Lab fixture licensing and provenance policy](fixture-licensing-provenance-policy-2026-06-13.md),
  [density-domain inversion ADR](../architecture/density-domain-inversion-adr-2026-06-13.md),
  and [input profile strategy ADR](../architecture/input-profile-strategy-adr-2026-06-13.md).

## Purpose

Measured-profile fixtures describe how RawEngine derived or validated a
Negative Lab profile from real film/process measurements. They are stricter than
generic preset metadata because the same stock can produce different curves
when the lab process, scanner/camera, light source, input profile, target, or
measurement method changes.

This format is intended to make measured profile work repeatable without
committing private scans or premature runtime schemas. A fixture record should
answer these questions:

- what film/process/profile claim is being measured;
- what source material and rights allow the measurement;
- what device, target, and method produced the numeric data;
- what acquisition assumptions make the density and channel values meaningful;
- what validation gates must pass before the profile can be shipped or used for
  quality claims.

## Fixture Boundary

A measured-profile fixture is metadata plus numeric measurement data. It may
reference raster files, target files, sidecar measurements, or private CI
artifacts, but it does not require those payloads to be public.

The fixture record should be stored separately from shipped profile presets. A
runtime `NegativeProfile` may later reference an approved fixture by ID and
hash, but profile code should not become the source of truth for measurement
provenance.

## Format Versioning

Use two versions because they change for different reasons:

| Field                    | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `fixture_format_version` | Version of this measured fixture document/schema shape.                 |
| `profile_algorithm_id`   | Negative Lab algorithm that consumes or validates the measured profile. |
| `measurement_method_id`  | Versioned measurement procedure and reduction method.                   |
| `source_revision`        | Optional revision for private measurement workbooks or lab exports.     |

The first schema candidate should use:

```json
{
  "fixture_format_version": "measured_profile_fixture.v0.1",
  "profile_algorithm_id": "density_rgb_v1",
  "measurement_method_id": "manual_target_reduction.v0.1"
}
```

Breaking changes to field semantics, units, channel basis, or curve coordinate
systems require a new `fixture_format_version`. Changes to curve fitting,
smoothing, or profile application belong in `profile_algorithm_id` or
`measurement_method_id` unless the persisted data shape changes.

## Recommended Envelope

The first fixture schema should use a single top-level object:

```json
{
  "fixture_id": "measured.rawengine.c41.project_owned.001",
  "fixture_format_version": "measured_profile_fixture.v0.1",
  "lifecycle_state": "review_pending",
  "profile_claim": {
    "claim_level": "measured_project",
    "process_family": "c41_color_negative",
    "stock_registry_id": "registry.example.stock_400",
    "display_name": "Project-owned C-41 400 measurement",
    "allowed_copy": "Measured from project-owned fixtures for RawEngine profile development."
  },
  "rights": {},
  "provenance": {},
  "acquisition": {},
  "measurement_source": {},
  "measurement_data": {},
  "validation": {},
  "follow_ups": []
}
```

`fixture_id` must be stable, lowercase, ASCII, and namespaced by claim type,
owner, process, and sequence or UUID. Do not encode a manufacturer or stock name
in the fixture ID unless the naming/legal policy allows that claim level.

## Licensing And Provenance Fields

Measured-profile records must include the negative fixture policy fields needed
to prove profile eligibility. Recommended `rights` fields:

| Field                             | Required | Notes                                                        |
| --------------------------------- | -------- | ------------------------------------------------------------ |
| `rights_owner`                    | Yes      | Person, project, partner, or organization that owns source.  |
| `license_id`                      | Yes      | Internal license/review record or `project_owned`.           |
| `allowed_distribution`            | Yes      | `metadata_only`, `public_payload`, `private_ci`, `none`.     |
| `derivative_distribution_allowed` | Yes      | Whether derived curves/profiles can ship.                    |
| `measurement_claim_allowed`       | Yes      | Whether numeric measurements can support validation claims.  |
| `profile_claim_allowed`           | Yes      | Whether a profile can reference this fixture as evidence.    |
| `allowed_naming`                  | Yes      | Generic, stock-reference, measured named-stock, or licensed. |
| `attribution_required`            | Yes      | Boolean plus text when attribution is required.              |
| `license_url_or_record`           | When any | Public URL, contract reference, or private review record.    |
| `license_reviewed_by`             | Yes      | Reviewer or team alias.                                      |
| `license_reviewed_at`             | Yes      | ISO 8601 date.                                               |
| `license_expires_at`              | If any   | Required for time-limited licensed material.                 |

Recommended `provenance` fields:

- `source_fixture_ids`: related scan, target, or roll fixture records;
- `source_payload_policy`: whether referenced payloads may be committed,
  downloaded, or used only in private CI;
- `content_hashes`: hashes for source scans, target measurement files, and
  derived measurement tables when those artifacts are available;
- `roll_or_sheet_identifier`: roll, sheet, strip, or batch label;
- `frame_identifiers`: frames used for the measurement;
- `process_lab_or_operator`: lab, home process, or operator if shareable;
- `development_process_known`: whether process details are known enough for a
  measured claim;
- `development_notes`: chemistry, push/pull, time, temperature, replenishment,
  or lab notes when known;
- `review_issue`: tracking issue or PR for approval history;
- `reviewer`, `reviewed_at`, and `review_expires_at`.

Unknown rights or unknown source setup must keep `lifecycle_state` below
`approved_profile_measurement`.

## Measurement Source Fields

`measurement_source` describes how numeric values were produced. It should not
hide the distinction between direct densitometer/spectrophotometer readings,
scanner-derived estimates, and manually reduced target data.

Recommended fields:

| Field                        | Required | Notes                                                             |
| ---------------------------- | -------- | ----------------------------------------------------------------- |
| `measurement_kind`           | Yes      | `densitometer`, `spectro`, `scanner_estimate`, `camera_estimate`. |
| `measurement_device`         | Yes      | Device model or `unknown`.                                        |
| `measurement_device_profile` | If any   | Device calibration/profile identifier.                            |
| `measurement_device_serial`  | If safe  | Redacted when private.                                            |
| `calibration_target_kind`    | Yes      | `step_wedge`, `colorchecker`, `it8`, `gray_card`, `none`.         |
| `calibration_target_id`      | If any   | Target serial/profile/reference ID.                               |
| `target_reference_file`      | If any   | Referenced private or public measurement file.                    |
| `measurement_units`          | Yes      | `density_log10`, `linear_rgb`, `lab_d50`, or explicit unit.       |
| `measurement_geometry`       | If known | Transmission/reflection, aperture, observer, and backing notes.   |
| `sample_count`               | Yes      | Total accepted measurement points.                                |
| `rejected_sample_count`      | Yes      | Count plus reason codes.                                          |
| `operator`                   | Yes      | Person, team, lab, or `unknown`.                                  |
| `measured_at`                | Yes      | ISO 8601 date/time or date.                                       |
| `reduction_software`         | Yes      | Tool and version used to reduce raw measurements.                 |
| `reduction_notes`            | If any   | Manual edits, smoothing, fitting, interpolation, or exclusions.   |

Direct target measurements should preserve the original reference file hash.
Scanner- or camera-derived estimates must carry reduced confidence and must not
be promoted as equivalent to independent densitometer/spectro measurements.

## Acquisition Assumptions

`acquisition` records the input basis for any scan-derived density values and
must line up with the Negative Lab input profile strategy.

Required fields:

- `input_mode`: `camera_raw`, `camera_tiff`, `flatbed_tiff`, `lab_tiff`,
  `lab_jpeg`, `contact_sheet`, or `unknown`;
- `pixel_basis`: `camera_raw_rgb`, `camera_rendered`, `scanner_rgb`,
  `lab_rendered_rgb`, `display_rgb`, or `unknown`;
- `scanner_or_camera_model`;
- `lens_model` when applicable;
- `scanner_software` and `scanner_software_version` when applicable;
- `light_source_type`;
- `light_source_cct` and `light_source_confidence`;
- `input_profile_source`;
- `input_profile_id` and `input_profile_version`;
- `embedded_profile_summary` when present;
- `bit_depth`, `file_format`, and `compression_kind`;
- `auto_exposure_suspected`, `auto_color_suspected`,
  `auto_contrast_suspected`, `dust_removal_suspected`, and
  `sharpening_suspected`;
- `base_fog_sample_regions` and `rejected_sample_regions` when source scans are
  used.

## Illuminant And Color Assumptions

Measured fixtures must declare the color assumptions used by profile fitting:

| Field                      | Required | Notes                                                           |
| -------------------------- | -------- | --------------------------------------------------------------- |
| `illuminant`               | Yes      | `D50`, `D55`, `D65`, scanner lamp ID, LED CCT, or custom.       |
| `observer`                 | If Lab   | Usually `2deg` or `10deg` for colorimetric target data.         |
| `input_profile_assumption` | Yes      | Explicit profile, embedded ICC, scanner RGB, or unknown.        |
| `working_space`            | Yes      | Space used for reduced RGB or positive comparison values.       |
| `white_reference`          | Yes      | Target patch, film base, scanner white, or explicit standard.   |
| `black_reference`          | Yes      | D-max patch, scanner black, clear base floor, or explicit zero. |
| `chromatic_adaptation`     | If any   | Method used when adapting target values between illuminants.    |

If illuminant or input-profile assumptions are unknown, the fixture may still
be useful for exploratory fitting, but validation must emit warnings and block
measured-profile shipping claims.

## Measurement Data Shape

`measurement_data` should separate observed density samples, fitted curves, and
profile parameters. Numeric fields should use finite decimal numbers only; no
NaN, infinity, strings for numbers, or implicit units.

Recommended object shape:

```json
{
  "measurement_data": {
    "channel_basis": "scan_rgb",
    "density_units": "density_log10",
    "sample_domain": "relative_to_base_fog",
    "base_fog": {
      "red": 0.18,
      "green": 0.42,
      "blue": 0.73
    },
    "density_samples": [],
    "channel_curves": {},
    "neutral_axis": [],
    "fit_summary": {}
  }
}
```

### Density Samples

Each accepted sample should use explicit coordinates and provenance:

```json
{
  "sample_id": "frame01_step_06",
  "source_frame_id": "frame01",
  "sample_role": "step_patch",
  "patch_label": "06",
  "region": { "x": 1024, "y": 384, "width": 48, "height": 48 },
  "density": { "red": 0.82, "green": 0.94, "blue": 1.17 },
  "positive_reference": {
    "space": "lab_d50",
    "l": 52.1,
    "a": 1.2,
    "b": -3.6
  },
  "weight": 1,
  "warnings": []
}
```

`density` values are relative to the declared base/fog unless
`sample_domain` says otherwise. Rejected samples should be stored separately
with reason codes instead of being deleted from the record.

### Curve Data

Curve data should be monotonic per channel and should declare interpolation:

```json
{
  "channel_curves": {
    "red": {
      "interpolation": "linear",
      "points": [
        { "density": 0.0, "positive": 0.02 },
        { "density": 0.6, "positive": 0.48 },
        { "density": 1.8, "positive": 0.96 }
      ]
    }
  }
}
```

Required curve fields:

- `channel_curves.red`, `channel_curves.green`, and `channel_curves.blue`;
- ordered `points` arrays with at least two points per channel;
- finite `density` and `positive` values;
- declared interpolation, smoothing, and extrapolation policy;
- `density_min`, `density_max`, `positive_min`, and `positive_max` in
  `fit_summary`;
- per-channel fit error metrics when a target/reference exists.

Optional data:

- `neutral_axis`: gray or neutral target samples used for channel alignment;
- `color_patch_samples`: named color targets for colorimetric validation;
- `grain_or_texture_notes`: qualitative notes that do not affect objective
  profile math;
- `profile_parameters`: compact parameters derived from curves for runtime use.

## Validation Expectations

The eventual fixture lint should fail closed for measured-profile claims.

Required validation checks:

- top-level required fields are present and use known enum values;
- all versions use supported identifiers;
- fixture IDs, source IDs, and profile IDs are stable ASCII identifiers;
- rights fields allow the requested claim level and distribution;
- lifecycle state permits use in profile measurement;
- source artifact hashes are present for available payloads;
- measurement units, channel basis, illuminant, and input profile assumptions
  are explicit;
- density and curve values are finite and within declared numeric ranges;
- channel curves are ordered, monotonic where required, and contain matching
  channels;
- sample regions are non-empty and lie inside declared source dimensions when
  dimensions are available;
- rejected samples include reason codes;
- warnings are stable codes from the Negative Lab policy set;
- review dates are not expired for new measured-profile claims.

Recommended warning codes:

- `measured_profile_rights_unknown`
- `measured_profile_source_private`
- `measured_profile_setup_unknown`
- `measured_profile_input_profile_unknown`
- `measured_profile_illuminant_unknown`
- `measured_profile_estimated_from_rendered_input`
- `measured_profile_low_sample_count`
- `measured_profile_curve_non_monotonic`
- `measured_profile_review_expired`

Required CI should accept fixtures only when their `allowed_validation_uses`
include the requested gate, such as `profile_measurement`,
`density_math_reference`, `warning_stability`, or `schema_roundtrip`.

## Future Schema And Runtime Follow-Ups

This document should be converted into implementation work in small PRs:

1. Add a Zod schema for `MeasuredProfileFixtureV1`.
2. Add accepted and rejected sample artifacts that exercise rights, setup, and
   numeric validation.
3. Add a fixture lint command and wire it into `docs:check` or a dedicated
   Negative Lab validation lane.
4. Add profile claim gates that require approved measured fixtures before named
   measured profiles can ship.
5. Add runtime profile records that reference fixture IDs and content hashes
   instead of embedding measurement provenance.
6. Add app-server dry-run output that reports measured-profile warning codes
   before applying any profile.
7. Add private CI handling for restricted measurement payloads without exposing
   local paths, signed URLs, or private raster data.
8. Add review tooling for license expiry, measurement method changes, and input
   profile changes.

Until those follow-ups exist, this page is the practical contract for issue
#275 planning only.
