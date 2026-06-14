# Wavelet Detail-By-Scale Design

- Date: 2026-06-14
- Issue: #128 `detail(wavelet): design detail-by-scale controls`
- Milestone: 8: Detail Denoise And Wavelet Tools
- Scope: UI/API/pipeline design before runtime implementation.

## Decision

RawEngine should expose detail-by-scale controls as a professional detail panel
that separates fine texture, medium detail, coarse local contrast, and residual
tone. The first implementation should be conservative, luma-first, and validated
against false texture, halo, and color shift fixtures before it becomes a
default production tool.

The design goal is RawTherapee-level scale control without copying its dense UI.
The visible surface should feel like a focused Capture One/Lightroom-class tool:
few defaults, clear scale names, strong reset behavior, and advanced controls
hidden until needed.

## Scale Bands

Initial bands:

- `micro`: pores, grain, very fine fabric, eyelashes, line-pair detail.
- `fine`: hair, foliage edges, small product texture, small text boundaries.
- `medium`: object separation, mid-size texture, architectural edges.
- `coarse`: broad local contrast and shape separation.
- `residual`: base tone/color residual, protected by default.

Each band should record the effective radius or sigma range used by the runtime
so preview, export, sidecar replay, and app-server tools can explain the result.

## User Controls

First visible controls:

- enable/disable detail-by-scale;
- strength per band, default `0`;
- protect edges;
- protect flat/noise regions;
- luma-only mode, default enabled;
- reset band and reset all.

Advanced controls:

- band preview/solo;
- chroma detail amount;
- per-band masking when layer/mask integration exists;
- halo guard strength;
- noise floor override;
- blend mode between baseline and wavelet result.

Do not expose arbitrary kernel sizes in the first UI. API settings may preserve
effective radii, but user editing should stay anchored to stable band names.

## Pipeline Placement

The scale decomposition should run after RAW normalization, lens correction,
capture sharpening, and optional deblur. It should run before creative clarity,
structure, dehaze, film grain, output resize, and output sharpening.

Export and preview must use the same effective band settings. If the preview
uses GPU approximations, the implementation PR must include parity fixtures or
keep the feature experimental.

## Layer And Mask Behavior

Base implementation can be global-only. Layer/mask support should come after:

- global preview/export parity passes;
- band settings serialize through sidecars;
- masks can apply per-band strength without changing band decomposition
  globally;
- mask feathering avoids visible scale discontinuities at mask edges.

Per-layer scale edits should compose as deltas on top of the base decomposition,
not as repeated decompositions that compound halos.

## API And Sidecar Contract

Future settings should preserve:

- schema version;
- enabled flag;
- per-band requested/effective strength;
- luma/chroma routing;
- edge protection and noise protection;
- algorithm family and version;
- effective radii/sigma values;
- preview/export parity version;
- downgrade or disabled reason.

Invalid or missing settings must fail closed to disabled detail-by-scale, not
apply hidden sharpening defaults.

## Validation Gates

Runtime implementation must include:

- synthetic line-pair, slanted-edge, Siemens/star, checkerboard, and flat/noise
  fixtures;
- real-photo crops for skin, hair, foliage, fabric, architecture/text, and high
  ISO noise;
- crop sheets at 100 percent and 200 percent;
- per-band solo artifacts or equivalent debug output;
- metrics for acutance gain, halo width, ringing, chroma shift, and noise gain;
- preview/export parity proof;
- sidecar roundtrip and schema validation;
- runtime timing on representative macOS hardware.

Fail closed when a band increases halos, turns noise into structure, creates
false text/detail, or shifts color at high-contrast edges.

## Implementation Order

1. Add schema-only band settings and fixture contract.
2. Add synthetic fixture generator and metric checker.
3. Add CPU reference decomposition behind an experimental flag.
4. Add crop-sheet artifact generation.
5. Add GPU preview implementation after reference output is accepted.
6. Add polished UI with band preview/solo.
7. Add layer/mask integration.

## Validation Commands

- `bunx prettier --check docs/detail/wavelet-detail-by-scale-design-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
