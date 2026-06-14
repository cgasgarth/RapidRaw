# Focus Stacking Performance Validation Contract

Date: 2026-06-14
Scope: GitHub issue #195, focus stack performance tests

## Purpose

Focus stacking can consume large amounts of memory when many source frames,
sharpness maps, depth/confidence maps, retouch layers, and full-resolution
blends are held at once. RawEngine needs a validation contract before focus
stack runtime work is treated as apply-ready.

## Metrics

Every focus stack runtime implementation should report:

- source count and source dimensions;
- output dimensions and output pixel count;
- alignment mode and blend method;
- sharpness/depth/confidence map dimensions;
- rejected source count and rejection reasons;
- estimated peak memory and runtime from dry-run;
- observed peak memory and runtime when runtime measurement exists;
- tile count, chunk count, or streaming strategy when used;
- retouch-layer generation policy and artifact count;
- warning codes, block reasons, and downgrade reasons.

## Fixture Tiers

### Tier 0: Schema And Planning Contract

Required before runtime work lands.

- Validate focus stack command envelopes and dry-run/mutation result samples.
- Require source indexes, focus roles, alignment mode, blend method, output
  name, quality preference, and retouch-layer policy.
- Do not require raster fixtures or runtime measurements at this tier.

### Tier 1: Tiny Deterministic Smoke

Required before focus stacking becomes a required CI runtime check.

- Use tiny synthetic bracket fixtures that fit comfortably on every macOS
  runner.
- Exercise dry-run and apply through deterministic alignment/blend paths.
- Record output dimensions, source count, runtime, and estimated peak memory.
- Fail if apply succeeds without accepted dry-run plan metadata.

### Tier 2: Representative Local Review

Required before user-facing quality claims.

- Use real focus bracket fixtures with documented provenance.
- Capture sharpness map, rejected-frame list, final blend, and optional retouch
  layer artifacts.
- Review near/far transition regions, high-frequency texture, specular detail,
  subject edges, and background blur boundaries.
- Record runtime and peak memory for preview and final apply.

### Tier 3: Heavy/Nightly Performance

Required before large focus bracket workflows become default.

- Include high-resolution source sets with many focus slices.
- Exercise tile-backed rendering, cancellation, cleanup, and cache pressure.
- Track p50/p95 runtime, peak memory, output dimensions, rejected source counts,
  and failure categories.
- Keep this outside required PR CI until runtime cost is stable.

## Initial Budgets

Budgets are provisional until runtime baselines exist:

| Tier   | Required CI | Max Sources | Max Long Edge | Target Runtime | Target Peak Memory |
| ------ | ----------- | ----------- | ------------- | -------------- | ------------------ |
| Tier 0 | yes         | n/a         | n/a           | schema only    | schema only        |
| Tier 1 | future yes  | 3           | 512 px        | < 10 s         | < 1 GB             |
| Tier 2 | manual      | 12          | 2400 px       | reported       | reported           |
| Tier 3 | nightly     | 30+         | full size     | trended        | trended            |

Any implementation that exceeds a required budget must block apply, reduce
preview scope, downgrade quality, or clearly document why the budget is only
reported for that PR.

## CI Placement

- Tier 0 belongs in schema/sample validation.
- Tier 1 should become a required macOS check once deterministic tiny fixtures
  are implemented.
- Tier 2 should start as manual evidence attached to PRs.
- Tier 3 should start as scheduled or release-gate validation.

Do not add large focus bracket assets directly to required CI until fixture
licensing, hash policy, cache policy, and runtime stability are proven.

## Evidence Template

```markdown
## Focus Stack Performance Evidence

- Tier:
- Fixture set:
- Source count:
- Source dimensions:
- Output dimensions:
- Alignment mode:
- Blend method:
- Retouch-layer policy:
- Estimated runtime:
- Observed runtime:
- Estimated peak memory:
- Observed peak memory:
- Tile/chunk count:
- Sharpness/depth map artifacts:
- Rejected sources:
- Warning/block codes:
- Result: pass / blocked / manual-only
- Notes:
```

## Current Status

This contract does not add focus stack runtime benchmarks because the production
focus stack renderer is not implemented yet. It defines the validation gates
runtime PRs must satisfy once focus stacking image-processing code lands.
