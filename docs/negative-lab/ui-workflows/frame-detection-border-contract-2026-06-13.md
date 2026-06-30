# Negative Lab Frame Detection And Border Contract

- Date: 2026-06-13
- Issue: #272 `negative-lab(import): add frame splitting and border detection`
- Scope: schema and validation contract for suggested frame splits, crops,
  visible border metrics, and rejected frame candidates.

## Decision

Negative Lab frame splitting is represented as a typed detection result before
the app implements pixel detection, UI review, or crop application. The result
captures suggested crops, border confidence, visible border measurements,
rejected candidates, and warning codes so UI, app-server tools, and future
import code can review the same payload.

## Included Contracts

- `NegativeLabDetectedFrameCropV1`
- `NegativeLabFrameBorderMetricsV1`
- `NegativeLabDetectedFrameV1`
- `NegativeLabRejectedFrameCandidateV1`
- `NegativeLabFrameDetectionResultV1`
- `NegativeLabFrameCropEditV1`
- `NegativeLabApplyFrameCropParametersV1`

The generated sample is:

- `packages/rawengine-schema/samples/negative-lab-frame-detection-result-v1.json`

## Validation Rules

- Detected frame IDs must be unique within a detection result.
- Every detected frame must reference a source file listed in `sourceFileIds`.
- Crop dimensions must be positive, and crop origins must be non-negative.
- Border measurements are non-negative per edge.
- Low-confidence frame detection uses stable warning codes so UI and app-server
  dry-runs can explain why manual review is needed.
- Accepted detected crops must reference a detection run and source detection
  frame ID.
- Manual crop overrides must be recorded as manual or imported metadata, not as
  detected-frame output.
- Rejected detected crops require review notes so crop decisions remain
  auditable.
- A crop command cannot contain duplicate edits for the same frame.

## Deferred

This contract does not implement image analysis, crop rendering, contact sheet
UI, or border overlay rendering. Those should land as separate PRs with sample
images, visual artifacts, and UI validation.
