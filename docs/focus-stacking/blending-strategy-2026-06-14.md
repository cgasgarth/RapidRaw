# Focus Stack Blending Strategy

Date: 2026-06-14
Scope: GitHub issue #190, focus stack blending strategy

## Purpose

Focus stack blending combines aligned slices using the sharpness map while
preserving real texture, natural transitions, and editability. The blend path
must produce deterministic artifacts, expose ambiguous regions, and avoid
silently masking parallax or motion defects.

## Blend Inputs

Required:

- aligned focus slices in the same output bounds;
- winning-source map from sharpness-map generation;
- confidence or margin map;
- rejected-source list;
- requested blend method;
- retouch-layer policy;
- source hashes and graph revisions.

Optional:

- depth/confidence proxy map;
- edge mask from alignment or sharpness analysis;
- user-preferred base slice;
- preview-only retouch seeds.

## Initial Blend Methods

### Weighted Sharpness

Use when:

- fixture is low risk;
- focus transitions are broad;
- confidence margins are high;
- preview speed matters.

Behavior:

- blend source pixels using normalized sharpness weights;
- preserve hard winner regions where confidence is high;
- avoid smoothing across rejected-source boundaries;
- produce warning when low-confidence area exceeds threshold.

### Laplacian Pyramid

Use when:

- macro/product detail needs smoother transitions;
- winner map contains small but valid regions;
- source alignment confidence is high enough for multi-scale blending.

Behavior:

- blend low frequencies smoothly;
- preserve high-frequency detail from winning sources;
- avoid haloing at high-contrast boundaries;
- keep pyramid levels deterministic and recorded in runtime metadata.

### Depth Map

Depth-map blending is schema-planned and should remain gated until fixtures
prove stable depth/confidence map behavior. It may become the default only after
parallax and local-depth artifacts are reviewed across real fixtures.

## Boundary Handling

Blend boundaries must be explainable:

- prefer sharpness-map boundaries in high-confidence regions;
- smooth only where confidence margins are low;
- record retouch seeds for ambiguous boundary zones;
- warn when parallax causes discontinuity near strong edges;
- never fill missing content without explicit boundary/fill policy.

## Retouch Layer Integration

When `retouchLayerPolicy` is `generate_retouch_layer`, the blend stage should
produce an editable retouch layer with:

- source candidate references;
- localized mask regions;
- reason codes;
- before/after preview handles;
- provenance back to the accepted dry-run plan.

The retouch layer is required when confidence is low near visible detail or
when parallax warnings affect final output regions.

## Output Artifacts

Blend output should write:

- durable `merge_output` artifact for applied stacks;
- preview artifact for dry-run review;
- optional retouch layer artifact;
- sharpness and confidence map handles retained from earlier stages;
- validation metrics copied into the focus stack artifact.

The final artifact must remain editable as a derived source in the normal
non-destructive graph.

## Failure And Downgrade Rules

Block apply when:

- fewer than two usable slices remain;
- alignment confidence is below the apply threshold;
- rejected-source decisions are not reproducible;
- output crop/bounds changed after accepted dry run;
- source hash or graph revision changed;
- blend method is not supported by the selected engine.

Downgrade to preview-only when:

- runtime budget is too high for interactive apply;
- retouch layer is required but disabled;
- local alignment or depth-map support is schema-only.

## Validation Plan

Fast checks:

- schema sample drift;
- warning-code stability;
- source-state coverage;
- retouch policy and artifact consistency.

Image checks:

- synthetic foreground/midground/background chart;
- macro product label with high-frequency edges;
- natural texture fixture;
- parallax/motion stress fixture.

Visual review:

- inspect halos along boundaries;
- inspect false detail in low-texture regions;
- inspect retouch seed relevance;
- compare winner map to final blend;
- confirm rejected sources remain visible in provenance.

Issue #1939 adds `bun run check:focus-blend-halo-proof`, which records blend
output hashes, region MAE, halo risk, and preview/export parity status at
`docs/validation/proofs/focus/focus-blend-halo-proof-2026-06-18.json`.

## Out Of Scope

This document does not implement blend kernels, GPU execution, UI retouch tools,
or runtime image fixtures. Those should land as separate PRs after the alignment
and sharpness-map contracts are in place.
