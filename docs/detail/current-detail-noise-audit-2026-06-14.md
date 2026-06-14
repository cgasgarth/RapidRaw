# Current Detail And Noise Tool Audit

Issue: #123

This audit records the current RapidRAW detail, sharpening, noise, dehaze, and chromatic-aberration surface before adding Capture One/Lightroom-class detail tools.

## Current User-Facing Tools

| Area                      | Current surface                                                   | Current implementation evidence                                       | Gap against RawEngine target                                                                                                   |
| ------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Capture/detail sharpening | `sharpness`, `sharpnessThreshold` in the Details panel            | UI adjustment state, GPU blur inputs, export reset path               | Single generic sharpening control; no capture/output sharpening split, radius/detail/masking controls, or fixture proof        |
| Local contrast            | `clarity`, `structure`, `dehaze`                                  | GPU processing creates separate blur inputs for clarity and structure | No explicit local-contrast stage contract, halo budget, scale policy, or regression fixtures                                   |
| Noise reduction           | `lumaNoiseReduction`, `colorNoiseReduction` plus AI denoise modal | UI adjustment state and `nind-denoise` ONNX path in Rust              | Chroma/luma controls exist but are not validated against high-ISO fixtures; AI denoise is not yet app-server/replay integrated |
| Chromatic aberration      | `chromaticAberrationRedCyan`, `chromaticAberrationBlueYellow`     | UI/detail adjustments and settings import mappings                    | No defringe-specific hue/range controls or fixture coverage                                                                    |
| Wavelet/detail-by-scale   | None                                                              | No wavelet runtime or UI path found                                   | Design and implementation remain open                                                                                          |
| Dust/spot visualization   | None                                                              | No dust visualization runtime or UI path found                        | Needs visible overlay, source preview, and fixture validation                                                                  |

## Pipeline Observations

- Preview detail processing is GPU-oriented and uses blur intermediates for sharpness, clarity, and structure.
- Export processing currently zeros sharpness, clarity, dehaze, and structure before export-specific work, so final-render parity must be proven before detail tools can be considered production-ready.
- AI denoise uses a local ONNX model path, but its command provenance, approvals, replay fixtures, and app-server tool coverage are still separate follow-up work.
- Existing settings/import paths already name the core detail fields, so future PRs should extend the current adjustment names rather than introduce duplicate controls.

## Required Follow-Ups

| Issue                                                         | Required next proof                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| #124 `detail(sharpen): add capture sharpening`                | Add capture-sharpening schema/fixtures and prove preview plus final-render routing. |
| #125 `detail(sharpen): add output sharpening`                 | Add export/output sharpening controls with print/screen target fixtures.            |
| #126 `detail(deblur): research deconvolution and lens deblur` | Document bounded deconvolution options and reject hallucination-prone paths.        |
| #127 `detail(local-contrast): refine local contrast`          | Add halo-safe local-contrast validation with edge fixtures.                         |
| #128 `detail(wavelet): design detail-by-scale controls`       | Define scale bands, UI behavior, and masking interactions.                          |
| #129 `detail(wavelet): implement detail-by-scale controls`    | Add runtime and fixture proof after #128 lands.                                     |
| #130 `detail(noise): separate chroma and luma noise`          | Add high-ISO fixture metrics for chroma/luma separation.                            |
| #131 `validation(noise): add high ISO fixture set`            | Add licensed or synthetic high-ISO validation assets and metrics.                   |
| #132 `detail(defringe): improve defringe controls`            | Add hue/range defringe controls and purple/green fringe fixtures.                   |
| #133 `detail(dust): add dust spot visualization`              | Add dust overlay and false-positive/false-negative fixture checks.                  |
| #134 `detail(ai-denoise): research AI denoise path`           | Decide local model, approval, provenance, and app-server migration plan.            |

## Validation

- `bunx prettier --check docs/detail/current-detail-noise-audit-2026-06-14.md docs/index.md docs/site-navigation.json`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
