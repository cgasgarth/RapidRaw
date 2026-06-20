# Mask Refinement Runtime

- Issue: #117
- Scope: feather, density, edge shift, smoothness, and edge contrast refinement
  for rendered mask bitmaps.
- Runtime status: renderer-applied. User-facing refinement controls remain
  future work.

## Runtime Contract

`src/schemas/maskParameterSchemas.ts` defines the TypeScript-facing Zod schema
for mask refinement parameters. `src/utils/maskRefinement.ts` normalizes partial
settings and evaluates fixture weights for deterministic validation.

`src-tauri/src/mask_generation.rs` mirrors the contract with
`MaskRefinementParameters` and applies refinement after each visible submask
bitmap is generated:

- `edgeShiftPx` dilates or erodes the mask before feathering;
- `featherPx` applies Gaussian feathering in render pixels;
- `smoothness` blends linear mask weights toward smoothstep;
- `edgeContrast` steepens mask transition weights;
- `density` scales the final mask weight.

## Validation

`tests/integration/checks/check-mask-refinement-parameters.ts` verifies fixture normalization,
invalid schema rejection, and Rust renderer coverage for the refinement struct,
edge shift, feathering, and submask wiring.

Rust unit tests cover density scaling and positive edge-shift dilation.

## Remaining Work

- Add user-facing controls in the mask inspector.
- Add visual/browser evidence once controls are exposed.
- Add full-image artifact comparisons for refine-heavy masks.
