# ADR-NEG-003: Input Profile Strategy For Camera, Flatbed, And Lab Scans

- Date: 2026-06-13
- Related issue: #271 `negative-lab(import): support scan input modes and roll sessions`
- Status: proposed
- Scope: acquisition input modes, profile confidence, roll/session attachment,
  warnings, validation gates, and schema boundaries before negative conversion.

## Context

Negative Lab conversion quality depends on what the input pixels mean before
the density-domain model runs. Camera-scanned RAW files, camera-exported TIFFs,
flatbed TIFFs, lab JPEGs, lab TIFFs, and contact sheets can all represent the
same film frame with very different assumptions baked in.

RawEngine needs a durable acquisition contract before it can safely implement
scan input modes, roll sessions, automatic base detection, stock mappings,
measured profiles, app-server dry-runs, or batch roll normalization. The goal is
not to reject imperfect scans; it is to make imperfect inputs explicit and
prevent low-confidence scans from silently receiving high-confidence conversion
or stock-profile claims.

This ADR builds on the density-domain inversion ADR and fixture/provenance
policy. It does not implement frame splitting, image decoding, or UI.

## Decision

RawEngine will treat scan acquisition as a first-class stage named
`acquisition`. The stage produces a versioned `NegativeAcquisitionProfile` and a
linearized `LinearScanRgb` handoff for objective inversion when the input is
eligible.

The acquisition stage has four jobs:

1. classify the input mode and source confidence;
2. describe the color/profile basis of the input pixels;
3. record scan setup, correction, and limitation metadata in roll/session state;
4. emit stable warnings before base/fog estimation or density conversion.

Acquisition metadata must be stored with the roll/session and command log. It
must not be transient UI state, hidden inside a stock preset, or inferred only
from file extension.

## Input Modes

V1 must support these acquisition modes as explicit enum values:

| Mode            | Typical source                         | Initial confidence | Objective conversion behavior                                      |
| --------------- | -------------------------------------- | ------------------ | ------------------------------------------------------------------ |
| `camera_raw`    | RAW/DNG copy-stand negative capture    | high when profiled | Preferred path; decode to linear camera/capture RGB.               |
| `camera_tiff`   | TIFF/PNG/JPEG rendered from camera RAW | medium             | Allowed when profile/render assumptions are declared.              |
| `flatbed_tiff`  | 16-bit scanner TIFF                    | medium/high        | Allowed with embedded or declared scanner profile.                 |
| `lab_tiff`      | lab scanner TIFF                       | medium             | Allowed with warnings when scanner/software corrections are fuzzy. |
| `lab_jpeg`      | minilab or consumer lab JPEG           | low                | Allowed for creative workflows; objective claims downgraded.       |
| `contact_sheet` | multi-frame scan or strip scan         | varies             | Requires frame/crop metadata before per-frame conversion.          |
| `unknown`       | missing or ambiguous source            | low                | Requires explicit user confirmation before objective workflows.    |

The acquisition mode can be changed by the user, but the command log must record
the old value, new value, reason, source, and warnings added or removed.

## Pixel Basis

Every acquisition profile must declare the input pixel basis:

| Basis              | Meaning                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| `camera_raw_rgb`   | Linear camera-space values from RAW decode before creative rendering.    |
| `camera_rendered`  | RGB rendered by a camera RAW processor or external editor.               |
| `scanner_rgb`      | Scanner RGB with embedded or declared scanner profile.                   |
| `lab_rendered_rgb` | Lab-rendered RGB with unknown or partially known scanner corrections.    |
| `display_rgb`      | Display-referred sRGB/P3/etc.; usable only with reduced confidence.      |
| `unknown`          | Pixel meaning cannot be trusted for objective inversion without warning. |

Objective density conversion may proceed only after acquisition produces a
linearized scan-channel buffer. Display-referred or lab-rendered sources must
carry warnings and reduced confidence. They are still editable, but the UI/API
must not present their output as equivalent to a profiled RAW or scanner TIFF.

## Profile Sources

The acquisition stage may use these profile sources:

- embedded ICC profile;
- user-selected scanner ICC/profile;
- user-selected camera/input profile;
- camera metadata and RAW decode profile;
- project-owned scanner/camera/light-source profile;
- generic scanner/camera assumption;
- assumed sRGB/P3 for rendered files;
- unknown profile.

Each source must record `profile_source`, `profile_id`, `profile_version`,
`profile_confidence`, and `profile_notes`.

When multiple profile sources exist, priority is:

1. explicit user/project profile;
2. embedded profile with valid metadata;
3. RAW decoder camera profile;
4. documented generic profile;
5. assumed display profile;
6. unknown.

Profile choice is objective acquisition metadata. It must not be encoded in
`ProcessProfile`, `StockProfile`, creative presets, or user look presets.

## Roll And Session Attachment

Negative Lab creates a `NegativeRollSession` for any batch or multi-frame work.
Single-image workflows may create a lightweight one-frame session so the same
schema and commands replay later.

A roll/session stores:

- `session_id`
- `schema_version`
- `acquisition_profile_id`
- `input_mode`
- `pixel_basis`
- `process_family`
- `source_files`
- `frame_records`
- `shared_base_samples`
- `anchor_frames`
- `roll_defaults`
- `per_frame_overrides`
- `acquisition_warnings`
- `conversion_warnings`
- `qc_status`
- `provenance_entries`

Each frame stores:

- source file identity and content hash;
- frame index and optional roll frame number;
- crop, rotation, perspective, and border/rebate state;
- frame-local acquisition overrides;
- base-sample links;
- conversion command IDs;
- positive variant IDs;
- warning state and QC state.

Roll-level settings may synchronize only objective or semi-objective acquisition
and conversion fields by default. Creative synchronization must be explicit.

## Acquisition Profile Fields

The first `NegativeAcquisitionProfile` schema should include:

- `profile_id`
- `schema_version`
- `input_mode`
- `pixel_basis`
- `capture_device_type`
- `capture_device_name`
- `scanner_or_camera_model`
- `lens_model`
- `scanner_software`
- `scanner_software_version`
- `light_source_type`
- `light_source_cct`
- `light_source_confidence`
- `diffuser_or_holder_notes`
- `film_holder_type`
- `input_profile_source`
- `input_profile_id`
- `input_profile_version`
- `embedded_profile_summary`
- `bit_depth`
- `file_format`
- `compression_kind`
- `compression_confidence`
- `visible_base_state`
- `rebate_or_border_state`
- `frame_spacing_state`
- `auto_exposure_suspected`
- `auto_color_suspected`
- `auto_contrast_suspected`
- `sharpening_suspected`
- `dust_removal_suspected`
- `ir_cleaning_suspected`
- `pre_inversion_suspected`
- `channel_clipping_score`
- `uneven_illumination_score`
- `compression_artifact_score`
- `profile_confidence`
- `acquisition_confidence`
- `warnings`
- `created_from`
- `reviewed_at`

Unknown fields are allowed, but unknowns must lower confidence and remain
visible in UI, dry-runs, app-server responses, and reports.

## Confidence Model

Acquisition confidence is a structured output, not a freeform note:

| Confidence | Meaning                                                                  |
| ---------- | ------------------------------------------------------------------------ |
| `high`     | Pixel basis, profile, bit depth, and correction assumptions are strong.  |
| `medium`   | Usable for objective conversion with visible caveats.                    |
| `low`      | Useful for creative edits or manual workflows; objective claims limited. |
| `blocked`  | Cannot proceed until the user provides missing information or samples.   |

Confidence must affect:

- automatic base detection;
- roll-level synchronization;
- stock reference mappings;
- measured-profile eligibility;
- agent batch operations;
- warning severity;
- QC status defaults.

Low confidence does not block manual editing. It blocks silent automation and
overconfident claims.

## Stable Warning Codes

The acquisition stage must emit stable warning codes:

- `unknown_input_mode`
- `unknown_pixel_basis`
- `unknown_input_profile`
- `assumed_display_profile`
- `display_referred_input`
- `lossy_input`
- `low_bit_depth_input`
- `suspected_lab_correction`
- `suspected_pre_inversion`
- `suspected_auto_exposure`
- `suspected_auto_color`
- `suspected_auto_contrast`
- `suspected_sharpening`
- `suspected_ir_cleaning`
- `missing_visible_base`
- `cropped_no_border`
- `clipped_base_channel`
- `uneven_illumination`
- `mixed_frame_input_modes`
- `contact_sheet_requires_split`
- `profile_mismatch`
- `low_acquisition_confidence`

Warnings must include severity, affected frame/session scope, evidence summary,
and whether the warning blocks automation.

## UI Policy

The first UI should expose acquisition status before conversion:

- source type segmented control;
- embedded profile and assumed profile readout;
- bit depth and compression badges;
- visible-base and border/rebate state;
- auto-correction suspicion badges;
- confidence badge;
- warning list with frame/session scope;
- "safe to auto-convert" and "manual review required" states;
- profile picker for scanner/camera/light-source assumptions;
- roll/session assignment and one-frame-session fallback.

The UI must avoid burying low-confidence warnings behind a successful-looking
positive preview.

## API And App-Server Policy

All API and future app-server tools that inspect or modify negative-lab inputs
must return:

- acquisition profile ID and version;
- input mode;
- pixel basis;
- confidence;
- warnings;
- affected frames;
- parameter diff;
- dry-run/apply state;
- provenance entry ID.

Agent tools may propose acquisition profiles, but applying a low-confidence
profile, global roll profile, or batch correction requires explicit dry-run
evidence and user approval.

## Validation

First validation gates:

- Zod schema parse/reject tests for `NegativeAcquisitionProfile`;
- Zod schema parse/reject tests for `NegativeRollSession`;
- enum exhaustiveness tests for input modes, pixel bases, confidence, and
  warnings;
- sample artifact drift checks once schema samples exist;
- classifier tests for camera RAW, flatbed TIFF, lab JPEG, contact sheet, and
  unknown cases using synthetic metadata;
- command replay tests proving acquisition changes produce deterministic diffs;
- docs link checks for this ADR and plan references.

Later validation gates:

- fixture-backed metadata extraction tests;
- scanner/camera profile roundtrip tests;
- visible-base and border-state fixture tests;
- warning stability tests for lossy/lab/auto-corrected inputs;
- app-server dry-run tests for low-confidence acquisition changes.

## Implementation Order

1. Add this ADR and keep the plan/docs linked.
2. Add schemas for acquisition profile, roll session, frame record, warnings, and
   confidence.
3. Add sample JSON artifacts and schema drift checks.
4. Add metadata-only classifier fixtures.
5. Add dry-run command envelope for acquisition profile changes.
6. Add a hidden UI acquisition summary panel.
7. Add roll/session creation and one-frame fallback.
8. Add frame/contact-sheet metadata records before pixel splitting.
9. Add app-server inspect/plan tools after schema and dry-run gates exist.

## Consequences

Positive consequences:

- Scan assumptions become inspectable and replayable before pixel conversion.
- Camera, flatbed, lab, and contact-sheet workflows can share one command model.
- Low-confidence lab JPEGs stay usable without overclaiming objective quality.
- Stock and process profiles cannot smuggle scanner/camera corrections.

Tradeoffs:

- Early implementation must collect metadata before it can feel automatic.
- Some workflows will show warnings even when the preview looks acceptable.
- Roll/session schema work becomes a prerequisite for robust batch conversion.

Key risks and mitigations:

- **Overconfident lab scans**: lower confidence and preserve warning codes.
- **Profile-class leakage**: keep acquisition profile fields separate from
  process/stock/creative profile schemas.
- **Contact-sheet ambiguity**: require frame records before per-frame conversion.
- **Agent overreach**: require dry-run evidence and explicit approval for
  low-confidence or batch acquisition changes.
