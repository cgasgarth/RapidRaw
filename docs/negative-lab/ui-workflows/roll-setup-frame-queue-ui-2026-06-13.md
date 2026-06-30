# Negative Lab Roll Setup And Frame Queue UI

- Date: 2026-06-13
- Issue: #267 `negative-lab(ui): add roll setup and frame queue design`
- Scope: design contract for the dedicated Negative Lab roll setup, frame queue,
  batch readiness, and handoff to QC review.

## Purpose

Negative Lab needs a dedicated workflow surface for roll-based work. The user
should be able to import a strip, contact sheet, folder, or single frame; define
the roll setup; review frame detection; choose base/fog strategy; prepare a
conversion recipe; and see exactly which frames are ready for dry-run,
normalization, positive variant creation, and QC review.

This document is a UI and product contract. It does not implement React views,
Rust rendering, or new image-processing math.

## Primary User Flow

1. Create or open a Negative Lab session.
2. Set roll context: input mode, source assets, process family, session kind,
   acquisition profile, and pixel basis.
3. Review detected frames and rejected candidates.
4. Select clean base/fog sample regions and choose the base strategy.
5. Select the process profile or objective inversion curve set.
6. Choose anchor frames for roll normalization.
7. Dry-run the batch and inspect warnings, deltas, sample readouts, and queued
   output actions.
8. Apply the dry-run plan to create positive variants.
9. Move to QC review before export.

## Workspace Layout

The roll setup view should use a dense, professional tool layout instead of a
marketing or wizard page.

- Left rail: session and roll setup controls.
- Center canvas: active frame, strip, or contact-sheet preview with overlays.
- Right panel: selected frame details, sample readouts, warnings, and batch
  readiness.
- Bottom queue: frame thumbnails with status badges, warnings, and selection.

The first implementation can keep this behind a feature flag or development
route. It should not pretend to render final-quality conversion output until
the deterministic fixture gates exist.

## Roll Setup Controls

Roll setup should expose these controls in the left rail:

| Control         | UI Pattern        | Source Contract                         |
| --------------- | ----------------- | --------------------------------------- |
| Session kind    | Segmented control | `single_frame`, `roll`, `contact_sheet` |
| Input mode      | Select menu       | `NegativeInputMode`                     |
| Pixel basis     | Select menu       | `NegativePixelBasis`                    |
| Process family  | Segmented control | `NegativeLabSupportedProcessFamilyV1`   |
| Acquisition     | Select menu       | acquisition profile ID                  |
| Source assets   | File list         | `NegativeLabSourceAssetRefV1[]`         |
| Base strategy   | Segmented control | roll shared, anchor frame, per frame    |
| Normalization   | Segmented control | exposure, balance, density/balance      |
| Preview outputs | Checkbox group    | preview artifact purposes               |
| Dry-run         | Icon+text button  | `negativeLab.setConversionRecipe`       |

Warnings should be visible as status rows, not modal interruptions, unless a
warning blocks automation.

## Frame Queue Model

Each frame row or thumbnail needs enough state for scanning a whole roll:

- frame ID and index;
- source file ID;
- crop status and border confidence;
- base sample status;
- conversion recipe status;
- normalization role: anchor, included, excluded, rejected;
- warning count and highest severity;
- QC status;
- positive variant status.

Suggested frame queue statuses:

| Status                | Meaning                                        |
| --------------------- | ---------------------------------------------- |
| `needs_crop_review`   | Detection exists but crop is not accepted.     |
| `needs_base_sample`   | Frame or roll base/fog is missing.             |
| `ready_for_dry_run`   | Required setup exists, no blocking warning.    |
| `dry_run_ready`       | Dry-run artifacts exist for review.            |
| `normalization_ready` | Roll anchors and deltas are available.         |
| `positive_created`    | A positive variant has been created.           |
| `qc_warning`          | QC exists with warnings requiring review.      |
| `qc_approved`         | Frame is approved for downstream export.       |
| `excluded`            | Frame is intentionally excluded from batch.    |
| `blocked`             | A blocking warning or missing contract exists. |

Status badges should be compact and stable in width so the queue does not shift
as warnings change.

## Queue Actions

Frame queue actions should be scoped and reversible:

- select frame;
- multi-select frames;
- mark as anchor;
- exclude from batch;
- accept detected crop;
- open manual crop;
- add base sample;
- reject sample region;
- dry-run selected frames;
- create positive variants from approved dry-run;
- send selected frames to QC review.

Buttons should use icons where the meaning is familiar and include tooltips.
Bulk actions should show the exact affected frame count before applying.

## Command Mapping

The UI should not mutate Negative Lab state directly. Every meaningful action
should map to a typed command or dry-run contract.

| UI Action               | Command Or Contract                 |
| ----------------------- | ----------------------------------- |
| Create session          | `negativeLab.createSession`         |
| Accept/reject samples   | `negativeLab.updateBaseSamples`     |
| Estimate base/fog       | `negativeLab.estimateBaseFog`       |
| Set recipe              | `negativeLab.setConversionRecipe`   |
| Plan roll normalization | `negativeLab.planRollNormalization` |
| Create positive variant | `negativeLab.createPositiveVariant` |
| Set QC status           | `negativeLab.setFrameQcStatus`      |
| Apply crop edit         | `negativeLab.applyFrameCrop`        |
| Show batch state        | `NegativeLabRollBatchWorkflowV1`    |
| Show proof overlays     | `NegativeLabQcProofArtifactV1`      |

The UI should render dry-run results before any apply action. Apply actions
should require the dry-run plan ID and expected graph revision.

## Batch Readiness Rules

The roll setup view should compute readiness from schema-backed state:

- no rejected frame can be included in the batch;
- anchor frames must be included in the selected frame set;
- dry-run-ready stages must have dry-run plan IDs;
- applied stages must have command IDs;
- selected-frame or single-frame curve overrides must include frame selection;
- base/fog estimation must use accepted sample IDs only;
- blocking warnings disable batch apply;
- low-confidence warnings keep the batch reviewable but visibly flagged.

The readiness panel should show:

- next required stage;
- blocking reason, if any;
- warning summary by severity;
- anchor frame count;
- selected frame count;
- frames excluded by user;
- frames rejected by detection or QC;
- dry-run artifact availability.

## Sample Readouts

The first frame-details panel should show numeric readouts for selected samples
and selected frames:

- accepted sample count;
- rejected sample count;
- base RGB estimate;
- base density estimate;
- clipping fraction;
- base confidence score;
- density P01/P50/P99;
- selected curve-set ID and version;
- roll density delta;
- white-balance delta;
- output clipping fraction.

Initial unstable metrics can live in `negativeLabDryRunResultV1.numericMetrics`,
but repeated metrics should graduate into typed schemas once they are stable.

## Warning Presentation

Warnings should be grouped by scope:

- session warnings;
- source asset warnings;
- frame warnings;
- sample warnings;
- profile or recipe warnings;
- QC warnings.

Blocking warnings should disable apply actions and explain the missing evidence.
Non-blocking warnings should remain visible through dry-run, apply, provenance,
and QC proof artifacts.

## Visual Design Rules

- Use a utilitarian workstation feel: compact controls, restrained color, clear
  grouping, and scan-friendly status density.
- Avoid nested cards and decorative hero surfaces.
- Keep the center preview unframed or minimally framed so overlays are easy to
  inspect.
- Use stable queue row heights and thumbnail aspect ratios.
- Use icons for crop, warning, anchor, exclude, approve, reject, zoom, pan, and
  compare actions.
- Use segmented controls for mutually exclusive modes.
- Use checkboxes for preview artifact purposes.
- Use swatches only for color/channel readouts.
- Do not use giant type inside tool panels.
- Keep all toolbar and queue text within stable responsive bounds.

## Validation Requirements

Before a React implementation PR is considered complete, it should include:

- unit tests for frame status derivation;
- schema fixture coverage for roll batch workflow states;
- Storybook or local fixture states for empty, ready, warning, blocked,
  multi-select, and QC-approved queues;
- Playwright screenshots for desktop and narrow widths;
- canvas or image-pixel checks once overlays render real pixels;
- app-server dry-run transcript or fixture showing command mapping;
- accessibility checks for keyboard selection and focused actions.

## Deferred

Deferred from the first UI implementation:

- automatic stock detection;
- final-quality GPU conversion preview;
- exact named-stock UI claims;
- automatic base/fog detection without confidence gates;
- polished export workflow;
- cloud or remote agent execution;
- destructive writeback to source files.

These should land only after the schema, fixture, provenance, and QC proof
contracts can validate the behavior.
