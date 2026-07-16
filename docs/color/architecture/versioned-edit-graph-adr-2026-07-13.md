# ADR-GRAPH-001: Current Edit Graph Execution Contract

- Issue: #5399; current-contract cleanup: #5948 and #5965
- Status: accepted; the graph-v1 compatibility executor is retired
- Scope: native preview/export/thumbnail/preset render compilation and execution

## Decision

`CompiledEditGraph` is the render-authoritative contract produced once from a
revisioned adjustment snapshot. Production consumers pass that same immutable
graph to the CPU or WGPU backend; either backend rejects an adjustment ABI that
no longer matches the graph. Current nodes own typed scene, local, view, and
display payloads. `AllAdjustments` is only the generated current shader ABI and
cannot establish graph identity.

The persisted `rawEngineEditGraphVersion` must be present and exactly equal the
current contract version. Missing, malformed, old, and future versions fail
closed before cache lookup, graph compilation, or renderer dispatch. RapidRaw
does not migrate or execute pre-HEAD graph contracts.

## Current Domains And Execution

The current graph has explicit scene, view, and display ownership:

1. `camera_input_boundary` establishes `acescg_scene_linear_extended_v1`.
2. Geometry, retouch, detail, global scene, local scene, scene curves, and Film
   nodes operate in the declared scene domain.
3. `scene_to_view_transform` produces the view-encoded intermediate.
4. Display curves, LUT, grain, clipping overlay, dither, and render transport
   produce the requested output.

WGPU executes the current graph as three physical dispatch phases per tile in
one command buffer and one queue submission. Compatible current nodes may be
fused within their declared phase; this is an optimization of the current
typed graph, not a second executor or compatibility contract. The CPU backend
executes the same node order and is the supported fallback when WGPU is
unavailable or a current node cannot run on WGPU.

Every node declares its domain, range/precision/alpha policy, spatial support,
dependencies, local-adjustment policy, implementation identity, and payload
fingerprint. The receipt records ordered and omitted nodes, current WGPU phase
groups, graph identity, and exact shader-ABI currentness.

The complete production path, clamp, conversion, and adjustment-ownership
inventory is maintained in
`edit-graph-operation-inventory-2026-07-13.md`.

## Consumers And Currentness

Settled and interactive preview, export, thumbnails, soft-proof previews,
uncropped previews, preset/community previews, path previews, mask exports,
and LUT exports compile through the same strict graph boundary. Derived export
variants compile a new graph after intentional adjustment overrides; mutating
the shader ABI after compilation is rejected as
`edit_graph.stale_gpu_execution_abi`.

Cache and artifact fingerprints include the current graph fingerprint. Source,
geometry, retouch, detail, adjustment, view, and output changes therefore
invalidate execution identity through declared dependencies. Version validity
is checked before cache lookup, so obsolete input can never reuse a current
compiled plan.

## Validation

- Static checks find no graph-v1 node/pass/runtime variants, legacy view-process
  enum values, compatibility dispatch, or shader ABI version selector.
- Native tests require the exact current graph version and reject missing, old,
  future, fractional, negative, and nonnumeric values before rendering.
- Registry and conformance tests cover every current CPU/WGPU node adapter,
  phase group, resource declaration, and cache fingerprint.
- Runtime CPU/WGPU tests cover current scene extended range, RapidView, local
  masks, color nodes, Film/LUT/curves, preview/export parity, and CPU fallback.
- Runtime receipts prove three current dispatch phases, one command
  buffer/submission, cache deltas, conversions, and declared clamp classes.
- Private Alaska RAW proof verifies current preview/export identity and verifies
  that graph-v1 input is rejected before renderer dispatch; private inputs and
  outputs are never committed.
- Required affected precommit covers formatting, TypeScript 7, schema/ABI,
  shader, Clippy, and native-boundary gates.

## Compatibility

There is no edit-graph backward-compatibility promise while the product is
built toward the HEAD contract. Old or incomplete documents are rejected or
quarantined by the document/render boundary. Current crash recovery, corrupt
state quarantine, rebuildable caches, and CPU backend fallback remain
supported; none of those mechanisms may reinterpret an obsolete graph.
