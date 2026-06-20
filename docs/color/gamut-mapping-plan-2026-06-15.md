# Gamut Mapping Plan

Issue: #94 `color(gamut): add gamut mapping plan`

Runtime status: schema and fixture contract only. This PR does not modify live
preview pixels, export pixels, WGSL, or Rust image processing.

## Decision

RawEngine treats gamut mapping as an output-stage policy after scene-to-display
rendering and before profile encoding or export quantization. The first runtime
targets are `srgb` and `display_p3`; scene-referred data is explicitly allowed
to exceed an output cube and must not be mapped until a display/export target is
chosen.

The default first policy is `relative_colorimetric` with a deterministic clip
fallback. Perceptual mapping is planned, but remains warning-gated until image-
wide behavior is proven against fixtures and visual review because it may alter
in-gamut colors while compressing out-of-gamut colors.

## Pipeline Placement

1. Camera/input profile conversion.
2. Chromatic adaptation into the working space where required.
3. Scene-referred editing in `acescg_linear_v1`.
4. Scene-to-display transform.
5. Output gamut classification and mapping policy.
6. Output/profile encoding and export quantization.

## Contract

The Zod schema exposes:

- `rawEngineGamutMappingPolicyV1Schema`
- `rawEngineGamutMappingFixtureManifestV1Schema`
- `rawEngineGamutMappingFixtureCaseV1Schema`

Fixture classification is computed from `destinationLinearRgbBeforeMap`:

- `in_gamut`: all channels are within `[0, 1]`.
- `high_component`: one or more channels exceed `1`.
- `negative_component`: one or more channels are below `0`.
- `mixed_out_of_gamut`: both high and negative components exist.

## Guardrails

- `schema_only` policies must carry
  `output_gamut_mapping_not_runtime_applied_v1`.
- High-channel cases must carry `output_gamut_high_component_v1`.
- Negative-channel cases must carry `output_gamut_negative_component_v1`.
- Perceptual intent must carry
  `output_gamut_perceptual_intent_unproven_v1`.
- Runtime-overclaim statuses such as `preview_applied` and `export_applied` are
  rejected by schema.
- Non-finite RGB values are rejected.

## Current Gate Thresholds

The #1931 gate is deterministic and synthetic. It validates classification,
warning policy, clip fallback bounds, and a committed review report, but it does
not claim perceptual gamut mapping quality.

- Component boundary epsilon: `1e-12`.
- Minimum measurable out-of-gamut magnitude: `1e-6`.
- In-gamut cases must have `clipDeltaMax <= 1e-12`.
- Out-of-gamut cases must have `clipDeltaMax > 1e-12` and clip back into
  `[0, 1]`.
- The review artifact is
  `docs/validation/color-gamut-clipping-gate-2026-06-18.json`.

## Science Risks

- RGB clipping can shift hue and saturation, especially for saturated flowers,
  LEDs, stage lighting, and synthetic colors.
- OKLCH-style perceptual compression is acceptable for a future SDR output
  mapper prototype, but it is not a complete scene/HDR model.
- ICC/CMM behavior can differ by platform; fixture math should remain explicit
  and deterministic before trusting screenshots.
- ACEScg/AP1 is the working gamut, not an output gamut.

## Follow-Up Work

- Add CPU reference gamut mapper for sRGB and Display P3.
- Add preview/export parity fixtures using the same gamut policy.
- Add soft-proof and gamut-warning UI overlays.
- Add GPU readback parity once the runtime path exists.
- Add visual review images for saturated real RAW files before quality claims.

## Validation

- `bun run check:gamut-mapping`
- `bun run schema:check`
- `bun run check:chromatic-adaptation`
- `bun run check:colorchecker-fixtures`
- `bun run check:deltae-fixtures`
- `bun run check:color-cpu-gpu-parity`
- `bun run check:unsafe-casts`
- `bunx prettier --check docs/color/gamut-mapping-plan-2026-06-15.md fixtures/color/gamut-mapping-fixtures.json tests/integration/checks/check-gamut-mapping-fixtures.ts packages/rawengine-schema/src/rawEngineSchemas.ts docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json scripts/run-compact-checks.ts`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
