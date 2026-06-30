# Color Preview/Export Parity Fixtures

- Issue: #95 `validation(color): add CPU GPU parity checks for core color operations`
- Runtime gate slice: #1933 `color(science): CPU GPU parity gate`
- Scope: WGSL contract hashing plus CPU preview/export outputs for core color helpers.
- Runtime status: CPU preview/export mirror plus explicit GPU-unavailable state;
  no live GPU readback or rendered pixel fixture claim.

## Purpose

RawEngine needs preview/export parity evidence before color-quality claims can
be trusted across preview and deterministic reference paths. This first parity
gate keeps the claim narrow: it validates that selected WGPU shader helper
functions remain stable and that their CPU mirror math produces deterministic
fixture outputs.

## Covered Operations

The fixture set covers:

- linear exposure;
- white-balance temperature and tint multipliers;
- channel mixer;
- RGB color balance;
- luma levels;
- legacy display tonemap.

The checker hashes the WGSL function bodies for these helpers and compares CPU
mirror outputs against checked fixture values. Any shader helper drift requires
an intentional fixture update.

## Current Gate

The #1933 gate writes a committed validation report at
`docs/validation/proofs/color/color-cpu-gpu-parity-2026-06-18.json`. Each case records:

- the CPU mirror output;
- the checked expected output;
- per-channel artifact deltas and the case tolerance;
- `explicitly_unavailable_in_headless_ci` for the GPU/render path.

This keeps the issue from being closed as schema-only while avoiding a false
claim that CI has performed deterministic WGPU readback. The shader hashes bind
the fixture cases to the WGSL helper functions until a render-readback harness
is available.

## Not Yet Covered

This is not live GPU execution. Follow-up work still needs WGPU readback or
rendered image fixtures for:

- full color pipeline pixel parity;
- AgX scene-to-display parity;
- profile transform and chromatic adaptation parity;
- GPU precision and platform tolerance reporting.

## Validation

Run:

```sh
bun run check:color-preview-export-parity
```

## Validation Evidence

- `bun run check:color-preview-export-parity`
- `bun run check:deltae-fixtures`
- `bun run check:colorchecker-fixtures`
- `bun run check:unsafe-casts`
- `bunx prettier --check tests/integration/checks/color/check-color-cpu-gpu-parity.ts fixtures/color/proofs/cpu-gpu-parity-fixtures.json docs/color/runtime/color-cpu-gpu-parity-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun tests/integration/checks/check-markdown-links.ts`
- `git diff --check`
