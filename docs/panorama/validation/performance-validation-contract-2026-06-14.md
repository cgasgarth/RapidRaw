# Panorama Performance Validation Contract

Date: 2026-06-14
Scope: GitHub issue #185, panorama performance tests

## Purpose

Panorama stitching can create very large intermediate buffers, especially once
projection, exposure normalization, seam blending, and tile-backed rendering
are enabled. RawEngine needs a performance gate that catches runaway source
counts, output dimensions, memory estimates, and missing tiling sentinels before
runtime panorama work is promoted.

## Implemented Gate

This PR adds a metadata-only performance fixture gate:

- Manifest: `fixtures/panorama/panorama-performance-fixtures.json`
- Checker: `bun run check:panorama-performance-fixtures`
- Smoke path: `bun run check:performance-smoke`

The checker cross-validates performance budgets against
`fixtures/panorama/panorama-fixture-manifest.json`. It does not add large image
assets or full-resolution renders to required PR CI.

## Required Checks

The checker enforces:

- every performance fixture references an existing panorama fixture;
- performance fixture IDs are unique;
- at least two required PR metadata fixtures exist;
- at least one scheduled/nightly tiling sentinel exists;
- source count, source long edge, output pixels, memory budget, and runtime
  budgets stay inside the declared limits;
- required warning codes match the base fixture manifest;
- required PR fixtures remain metadata-only, non-local-only, tier 0 or tier 1,
  under 256 MB, and under 10 seconds.

## Current Fixture Tiers

| Fixture                                        | Tier                 | CI mode              | Purpose                     |
| ---------------------------------------------- | -------------------- | -------------------- | --------------------------- |
| `panorama.synthetic.horizontal-translation.v1` | tier 1 tiny smoke    | required PR metadata | happy-path budget sentinel  |
| `panorama.synthetic.disconnected-source.v1`    | tier 1 tiny smoke    | required PR metadata | excluded-source budget path |
| `panorama.synthetic.large-plan-only.v1`        | tier 3 heavy/nightly | scheduled nightly    | tiling and memory sentinel  |

## Evidence Template

Use this for panorama runtime PRs that change planning, stitching, seam blending,
tiling, or output generation:

```markdown
## Panorama Performance Evidence

- Fixture:
- Tier:
- CI mode:
- Source count:
- Max source long edge:
- Output dimensions:
- Output pixels:
- Runtime budget:
- Observed runtime:
- Memory budget:
- Observed peak memory:
- Warning codes:
- Tiling required:
- Result: pass / blocked / manual-only
- Notes:
```

## Current Status

This is not a full runtime benchmark. It is the executable metadata contract
that required PR CI can run cheaply today, while future runtime PRs add observed
measurements and optional/nightly image assets.

Issue #1930 adds `bun run check:panorama-projection-memory-proof`, which records
projection output, crop/full-canvas pixels, PR fixture budget hashes, and a
proxy memory estimate at
`docs/validation/proofs/panorama/panorama-projection-memory-proof-2026-06-18.json`.
