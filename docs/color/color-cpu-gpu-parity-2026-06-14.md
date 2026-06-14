# Color CPU/GPU Parity Fixtures

- Issue: #95 `validation(color): add CPU GPU parity checks for core color operations`
- Scope: WGSL contract hashing plus CPU mirror outputs for core color helpers.
- Runtime status: no live GPU readback or rendered pixel fixture claim.

## Purpose

RawEngine needs CPU/GPU parity evidence before color-quality claims can be
trusted across preview and deterministic reference paths. This first parity gate
keeps the claim narrow: it validates that selected WGPU shader helper functions
remain stable and that their CPU mirror math produces deterministic fixture
outputs.

## Covered Operations

The fixture set covers:

- linear exposure;
- white-balance temperature and tint multipliers;
- legacy display tonemap.

The checker hashes the WGSL function bodies for these helpers and compares CPU
mirror outputs against checked fixture values. Any shader helper drift requires
an intentional fixture update.

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
bun run check:color-cpu-gpu-parity
```

## Validation Evidence

- `bun run check:color-cpu-gpu-parity`
- `bun run check:color-scope-fixtures`
- `bun run check:deltae-fixtures`
- `bun run check:colorchecker-fixtures`
- `bun run check:unsafe-casts`
- `bunx prettier --check scripts/check-color-cpu-gpu-parity.mjs fixtures/color/cpu-gpu-parity-fixtures.json docs/color/color-cpu-gpu-parity-2026-06-14.md docs/index.md docs/site-navigation.json RAW_EDITOR_PLAN.md package.json`
- `bun scripts/check-markdown-links.mjs`
- `git diff --check`
