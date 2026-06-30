# Super-Resolution Performance Validation Contract

Date: 2026-06-14
Scope: GitHub issue #205, super-resolution performance tests

## Purpose

Super-resolution can become expensive quickly. RawEngine needs performance
validation that catches memory blowups, runaway runtimes, and preview/final
mismatches before SR is treated as apply-ready. This document defines the
required test tiers and evidence contract before runtime benchmarks are added.

## Metrics

Every SR runtime implementation should report:

- source count and source dimensions;
- requested and effective output scale;
- output dimensions and output pixel count;
- alignment mode and detail policy;
- dry-run estimate for peak memory and runtime;
- observed peak memory and runtime when runtime measurement exists;
- tile count or streaming/chunking strategy when output exceeds preview scale;
- preview artifact dimensions and final artifact dimensions;
- downgrade reason when effective scale, source count, or quality tier changes;
- warning codes and block codes from the dry-run summary.

## Fixture Tiers

### Tier 0: Schema-Only Contract

Required now.

- Validate `SuperResolutionDryRunSummaryV1` and `SuperResolutionArtifactV1`
  sample payloads.
- Validate warning/block codes, stale-state rules, model provenance, source
  hashes, source graph revisions, and accepted dry-run plan ID/hash.
- No raster fixtures or runtime measurements are required at this tier.

### Tier 1: Tiny Deterministic Smoke

Required before enabling runtime SR in required PR CI.

- Use tiny synthetic fixtures small enough for every macOS runner.
- Exercise dry-run and final apply through deterministic paths.
- Record output dimensions, source count, wall-clock runtime, and estimated peak
  memory.
- Fail if runtime produces output without source provenance or if apply succeeds
  after source-state mutation.

### Tier 2: Representative Local Quality/Performance

Required before claiming user-facing quality.

- Use chart and real-photo fixture subsets with documented provenance.
- Generate 100 percent and 200 percent crop sheets.
- Capture runtime and peak memory for preview and final apply.
- Compare expected and observed dimensions, scale, warning codes, and artifact
  hashes.
- Record review result using the visual artifact checklist.

### Tier 3: Heavy/Nightly Performance

Required before broad high-resolution workflows become default.

- Include larger RAW-derived fixture sets and multi-image bursts.
- Exercise tile-backed rendering, cancellation, and cleanup.
- Track p50/p95 runtime, peak memory, cache size, and failure categories.
- Run outside required PR CI until runtime cost is stable.

## Initial Budgets

Budgets are provisional until runtime baselines exist:

| Tier   | Required CI | Max Sources | Max Long Edge | Target Runtime | Target Peak Memory |
| ------ | ----------- | ----------- | ------------- | -------------- | ------------------ |
| Tier 0 | yes         | n/a         | n/a           | schema only    | schema only        |
| Tier 1 | future yes  | 3           | 512 px        | < 10 s         | < 1 GB             |
| Tier 2 | manual      | 8           | 2400 px       | reported       | reported           |
| Tier 3 | nightly     | 16+         | full size     | trended        | trended            |

Any PR that exceeds a budget must either block apply, downgrade scale/quality,
or document why the budget is not yet enforced.

## CI Placement

- Tier 0 remains covered by `bun run schema:check`.
- Tier 1 should become a required macOS check once the SR runtime can process
  deterministic tiny fixtures reliably.
- Tier 2 should start as manual/local evidence attached to PRs.
- Tier 3 should start as scheduled or release-gate validation.

Do not add large image assets directly to required CI until fixture licensing,
hashing, cache policy, and runtime stability are proven.

## Evidence Template

Use this in PRs that touch SR runtime or validation:

```markdown
## SR Performance Evidence

- Tier:
- Fixture set:
- Source count:
- Source dimensions:
- Requested scale:
- Effective scale:
- Output dimensions:
- Alignment mode:
- Detail policy:
- Estimated runtime:
- Observed runtime:
- Estimated peak memory:
- Observed peak memory:
- Tile/chunk count:
- Preview artifact:
- Final artifact:
- Warning/block codes:
- Downgrade reason:
- Result: pass / blocked / manual-only
- Notes:
```

## Current Status

This contract does not add runtime SR benchmarks because the production SR
renderer is not implemented yet. It defines the performance gates that runtime
PRs must satisfy as soon as image-processing code lands.

Issue #1941 adds `bun run check:sr-artifact-performance-proof`, which combines
the runtime output artifact hash with performance fixture budgets, proxy peak
memory, measured runtime, and preview/export parity status at
`docs/validation/proofs/super-resolution/super-resolution-artifact-performance-proof-2026-06-18.json`.
