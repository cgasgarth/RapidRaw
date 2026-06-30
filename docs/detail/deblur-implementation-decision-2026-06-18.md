# Deblur Implementation Decision

Issue: #126

## Decision

Use a constrained scene-linear, post-denoise deconvolution path as the first RawEngine deblur slice. The current bounded implementation direction is `constrained_van_cittert_gaussian_luma` with conservative strength/radius controls, synthetic Gaussian PSF fixtures, ringing/halo/noise guards, and explicit runtime limitations.

This is not a full lens-profile deblur system and not an AI deblur feature.

## Accepted Path

- Stage: `scene_linear_post_denoise`, ordered after luma/chroma denoise and before capture sharpening.
- Algorithm family: constrained iterative luma deconvolution using a Gaussian PSF approximation.
- Controls: `deblurEnabled`, `deblurStrength`, and `deblurSigmaPx`.
- Validation: accept only bounded synthetic cases where edge acutance improves without exceeding ringing, halo, false-edge, or noise-amplification thresholds.
- Provenance: dry-run/app-server and workflow reports must say whether the path is `cpu_reference_only`, `preview_export_parity`, or unavailable.

## Rejected First Paths

| Candidate                    | Decision | Reason                                                                                                         |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- |
| Exact lens-profile deblur    | Defer    | Needs camera/lens PSF calibration, aperture/focus-distance handling, and real RAW proof before quality claims. |
| Blind motion deconvolution   | Defer    | Unknown motion PSF is too artifact-prone for a first general-purpose control.                                  |
| AI deblur                    | Defer    | Requires model licensing, provenance, approvals, reproducibility, and artifact review beyond this issue.       |
| Raw-domain CFA deconvolution | Defer    | Demosaic-adjacent artifacts and sensor-pattern coupling make this a later science pass.                        |

## Current Evidence

- `fixtures/detail/deblur/deblur-fixtures.json` defines accepted Gaussian PSF cases and rejected high-noise, unknown-motion, and saturated-edge cases.
- `bun run check:deblur-fixtures` validates fixture scope and rejects private-path leakage.
- `bun run check:deblur-ringing` gates ringing, halo width, false edges, and noise amplification.
- `bun run check:deblur-cpu-reference` proves the CPU reference path applies accepted synthetic fixtures and skips rejected fixtures.
- `bun run check:deblur-workflow-smoke` proves preview/export parity for the bounded workflow path.
- `bun run check:deblur-ui-api` and `bun run check:deblur-app-server-tool` keep UI/API/app-server contracts explicit.

## Follow-Up Alignment

- #1867 `detail(runtime): deblur apply pipeline proof` is satisfied by the bounded apply/runtime path.
- #1868 `detail(e2e): deblur quality fixture proof` is satisfied for synthetic fixture proof only.
- Real RAW quality remains separate and must not be inferred from synthetic fixtures.

## Remaining Limits

- Synthetic fixtures do not prove broad photographic quality.
- Lens-specific PSF, motion blur, saturated-edge recovery, and noisy high-ISO cases remain guarded or rejected.
- Preview/export parity does not prove visual desirability; it only proves consistent application.
- The UI must continue labeling deblur as bounded and artifact-prone until real RAW review evidence is stronger.

## Next Runtime Quality Target

The next credible improvement is a real RAW edge/ringing review fixture with before/after preview and export artifacts, linked to the private/raw evidence ledger or to a project-owned public RAW asset. The gate should compare the same parameter set across preview and export, record ringing/halo notes, and reject improvements that only increase false detail.
