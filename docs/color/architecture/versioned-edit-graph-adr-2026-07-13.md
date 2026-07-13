# ADR-GRAPH-001: Versioned Edit Graph Execution Contract

- Issue: #5399
- Status: accepted; legacy-v1 compatibility and scene-referred-v2 implemented
- Scope: native preview/export/thumbnail/preset render compilation and execution

## Decision

`CompiledEditGraph` is the render-authoritative contract produced once from a
revisioned adjustment snapshot. Production consumers pass that same immutable
graph to the GPU executor; the executor rejects an adjustment ABI that no
longer matches the graph. V2 nodes own split typed scene, local, view, and
display payloads. `AllAdjustments` remains a temporary GPU transport ABI and a
frozen legacy-v1 compatibility payload; it cannot establish graph identity.

The persisted field `rawEngineEditGraphVersion` selects process behavior.
Existing sidecars without it default explicitly to `legacy_pipeline_v1`; saved
and reopened edits retain the version. Unsupported versions fail closed with a
stable native error instead of silently reinterpreting pixels.

## Legacy-V1 Domains And Order

The historical v1 process is recorded honestly as a fused compatibility node,
not relabeled as the physically split scene-safe v2 passes:

1. `camera_input_boundary`: `acescg_scene_linear_extended_v1`.
2. Optional geometry/retouch and pre-GPU detail nodes in the same extended
   scene-linear domain.
3. `legacy_gpu_scene_view_pass`: fused scene, local, look, tone-map, curve, LUT,
   and grain math from extended AP1 to `display_encoded_srgb_v1`.
4. Optional display clipping overlay.
5. Render transport/dither; export profile conversion remains an explicit
   downstream export policy.

Every node declares versions, domains, range/precision/alpha policy, spatial
support, dependencies, local-adjustment policy, implementation IDs, and a
payload fingerprint. The receipt records ordered and omitted nodes, fused GPU
groups, migration behavior, graph identity, and exact shader-ABI currentness.

## Scene-Referred-V2 Domains And Execution

V2 executes three physical WGPU dispatches per tile in one command buffer and
one queue submission:

1. scene-global and local composition produce an RGBA16F AP1 scene-linear
   intermediate;
2. the view transform produces an RGBA16F view-encoded intermediate;
3. display curves/LUT/grain, overlays, dither, and transport produce output.

The CPU reference executes the same stage order, including spatial auxiliaries,
local masks, tetrahedral LUTs, flare, and signed extended transfer behavior.
AP1 stages use AP1 luminance; display stages use view-encoded luma. A numerical
Metal/CPU regression distinguishes both coefficient sets. V2 preserves finite
negative and over-one scene values; legacy clamps remain isolated in v1.

The complete production path, clamp, conversion, and adjustment-ownership
inventory is maintained in
`edit-graph-operation-inventory-2026-07-13.md`.

## Consumers And Currentness

Settled and interactive preview, export, thumbnails, soft-proof previews,
uncropped previews, preset/community previews, path previews, mask exports,
and LUT exports compile through the graph boundary. Derived export variants
compile a new graph after their intentional adjustment overrides; mutating the
shader ABI after compilation is rejected as `edit_graph.stale_gpu_execution_abi`.

Cache and artifact full fingerprints use the graph fingerprint. Source,
geometry, retouch, detail, adjustment, view, and output changes therefore
invalidate the execution identity through declared dependencies.

## Validation

- Rust compiler tests: deterministic ordering/fingerprint, no-op omission,
  scoped invalidation, explicit/default legacy migration, unsupported-version
  rejection, and stale-ABI rejection.
- Native Metal test: a compiled graph executes through the real GPU path and
  changes pixels.
- Stage-matrix tests compare each spatial family and a complex combined stack
  against the CPU reference, including extended f16-relative tolerance.
- Runtime receipts prove three v2 dispatches, one command buffer/submission,
  cache hit/miss deltas, encode/wall timing, conversions, and clamp classes.
- Preview/export parity test: equivalent compiled preview and export graphs
  render identical pixels through the real GPU path.
- Private 6000x4000 Alaska ARW proof: production decode, real Metal v2
  preview/export identity, and a materially different legacy migration image;
  private input and output artifacts are never committed.
- TypeScript test: legacy normalization and JSON sidecar roundtrip preserve the
  graph version and adjustment values.
- Required affected precommit: formatting, TypeScript, unit/schema, strict
  Clippy, and native-boundary gates.

## Compatibility

V1 remains a single compatibility dispatch and is pixel-stable. V2 is selected
only by explicit persisted process version. Missing versions default to v1;
unsupported versions fail closed. The process is never silently upgraded.
