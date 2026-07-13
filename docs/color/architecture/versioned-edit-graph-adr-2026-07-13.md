# ADR-GRAPH-001: Versioned Edit Graph Execution Contract

- Issue: #5399
- Status: accepted, legacy-v1 migration implemented
- Scope: native preview/export/thumbnail/preset render compilation and execution

## Decision

`CompiledEditGraph` is the render-authoritative contract produced once from a
revisioned adjustment snapshot. Production consumers pass that same immutable
graph to the GPU executor; the executor rejects an adjustment ABI that no
longer matches the graph. `AllAdjustments` remains only the fused legacy shader
payload and cannot independently establish execution identity.

The persisted field `rawEngineEditGraphVersion` selects process behavior.
Existing sidecars without it default explicitly to `legacy_pipeline_v1`; saved
and reopened edits retain the version. Unsupported versions fail closed with a
stable native error instead of silently reinterpreting pixels.

## Legacy-V1 Domains And Order

The current shader is recorded honestly as a fused compatibility node, not as
separate scene-safe passes that do not yet exist:

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

This ADR does not relabel legacy shader math as a corrected scene-referred v2.
A future v2 must split the fused node only with CPU/WGPU parity, negative and
over-range preservation, output-transform, and migration-preview proof.

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
- Preview/export parity test: equivalent compiled preview and export graphs
  render identical pixels through the real GPU path.
- TypeScript test: legacy normalization and JSON sidecar roundtrip preserve the
  graph version and adjustment values.
- Required affected precommit: formatting, TypeScript, unit/schema, strict
  Clippy, and native-boundary gates.

## Follow-Ups

- Split the legacy fused shader into declared scene, view, display, and output
  passes without increasing tile submissions unnecessarily.
- Add a CPU/reference executor for the same nodes before claiming full backend
  parity or oversized-image fallback equivalence.
- Introduce `scene_referred_v2` only with an explicit migration preview and
  fixture-backed pixel deltas; never auto-upgrade legacy recipes.
