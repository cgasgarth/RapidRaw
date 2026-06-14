# Deconvolution And Lens Deblur Research

- Date: 2026-06-14
- Issue: #126 `detail(deblur): research deconvolution and lens deblur`
- Milestone: 8: Detail Denoise And Wavelet Tools
- Scope: research contract for bounded deconvolution/lens deblur.
- Consult status: preliminary research contract; implementation must not start
  until a RapidRaw project consult reviews the math, validation metrics, and
  iteration plan.

## Decision

RawEngine should add deconvolution only as an opt-in, bounded detail tool after
capture sharpening, output sharpening, local contrast, and validation fixtures
are strong enough to distinguish recovered lens detail from ringing, halos,
noise amplification, and false texture.

The first implementation should not promise "AI enhance" behavior. It should be
a conservative optical correction control for mildly blurred, well-sampled
source images where the blur model is explainable and the result is measurable.

## Accepted First Path

Use a classical deconvolution path before any learned deblur model:

- optional lens-profile PSF preset when reliable metadata exists;
- generic small-radius motion/defocus kernels for manual correction;
- Richardson-Lucy or Wiener-style restoration with strict iteration/strength
  caps;
- luma/detail-domain operation that preserves color ratios where possible;
- noise-aware damping tied to ISO/noise estimate and local flat-region masks;
- preview at 100 percent with final-render parity required before release.

The control should degrade to sharpening-only or disabled output when source
support is weak, the image is noisy, or the predicted overshoot/ringing budget is
exceeded.

## Rejected Or Deferred Paths

Do not implement these in the initial deblur work:

- hallucination-oriented deblur that invents faces, text, fabric, foliage, or
  eyelashes;
- blind deconvolution without visible confidence and review gates;
- model-based super-resolution/deblur hybrids that write final assets without
  provenance and artifact review;
- global default deblur on import;
- deblur controls that run after output sharpening and amplify export halos;
- preset names that imply guaranteed lens correction without fixture evidence.

Learned models can be reconsidered later only as clearly labeled restoration or
assistive preview paths with model provenance, opt-in approval, and false-detail
review.

## Pipeline Placement

The first deblur stage should run:

1. after demosaic, hot-pixel cleanup, lens corrections, and capture sharpening;
2. before creative local contrast, clarity, structure, output resizing, and
   output sharpening;
3. in a linear or scene-referred luma/detail representation;
4. with mask and layer routing only after the base image path is proven.

Preview and export must share the same effective settings. If GPU preview and
CPU/export implementations diverge, the PR must include fixture proof for both
or keep the feature hidden behind an experimental flag.

## User Controls

Initial UI/API controls should be narrow:

- enabled/disabled;
- mode: `lens`, `defocus`, `motion`, `custom`;
- amount;
- radius or kernel size;
- iterations, capped to a small safe range;
- damping/noise protection;
- edge protection;
- mask amount when layer integration exists.

The UI should show warnings for high ISO, under-sampled files, strong sharpening
already present, or high artifact risk. Presets should be descriptive, not
camera/lens-specific, unless backed by measured profiles.

## API And Sidecar Contract

Future sidecar/API settings should preserve:

- algorithm family and version;
- mode and effective kernel;
- requested/effective amount, radius, iterations, damping, and edge protection;
- source metadata used for lens-profile selection;
- artifact-risk summary;
- preview/export parity version;
- downgrade or block reason when deblur is reduced or disabled.

Missing, unknown, or invalid fields must fail closed to disabled deblur rather
than applying aggressive defaults.

## Validation Gates

A runtime deblur PR must include:

- synthetic slanted-edge and Siemens/star fixtures with known blur kernels;
- line-pair and text fixtures to detect ringing and invented strokes;
- flat/noise fixtures to detect grain amplification;
- real-photo crops for eyelashes/hair, foliage, fabric, architecture, and high
  ISO detail;
- before/after crop sheets at 100 percent and 200 percent;
- metrics for acutance/detail gain, overshoot, undershoot, ringing width, and
  noise amplification;
- preview/export parity checks;
- performance timing on representative macOS hardware;
- sidecar roundtrip and schema validation.

Deblur should fail closed when the measured gain is mostly sharpening halo,
aliasing, ringing, repeated false structure, or amplified chroma noise.

## Implementation Order

1. Add fixture manifests and synthetic blur-generation script.
2. Add schema-only settings with Zod validation and sidecar roundtrip.
3. Add CPU reference implementation behind an experimental flag.
4. Add metric and crop-sheet validators.
5. Add GPU preview only after CPU reference output is accepted.
6. Add UI controls with warnings and parity proof.
7. Add layer/mask support after base pipeline parity lands.

## Open Questions

- Whether the first reference implementation should be Richardson-Lucy, Wiener,
  or both behind a shared contract.
- Whether lens-profile PSF data is feasible from available open metadata, or
  whether the first version should stay manual/generic.
- Where to store per-region confidence/artifact overlays so app-server tools can
  explain results.

## Required Consult Follow-Up

Before any runtime deblur implementation PR, open a new RapidRaw ChatGPT project
consult with the GitHub repo attached. Ask it to review the deconvolution math,
noise-aware damping strategy, artifact metrics, fixture plan, and iterative
quality ladder. The resulting ADR or summary must record accepted advice,
rejected advice, validation thresholds, and the next measurable improvement
target.

## Validation Commands

- `bunx prettier --check docs/detail/deconvolution-lens-deblur-research-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
