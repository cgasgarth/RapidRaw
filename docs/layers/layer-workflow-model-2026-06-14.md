# Layer Workflow Model

- Date: 2026-06-14
- Issue: #108 `layers(ux): define final layer workflow model`
- Milestone: 7: Layers And Masking
- Runtime status: plan and contract only. This document does not make layer edits apply at runtime.

## Goal

RawEngine layers must behave like a professional local-adjustment stack, not a
UI-only mask list. The user should be able to create named layers, attach one or
more masks, apply layer-scoped adjustments, reorder the stack, change opacity and
blend mode, and replay the same result from UI, API, sidecar, command log, tests,
and future Codex app-server tools.

## Current State

RapidRaw already has mask containers and submasks in UI state. Current code
supports mask types such as brush, linear, radial, luminance, color, subject,
sky, foreground, depth, all, flow, and quick eraser. Submasks already carry
mode, invert, opacity, visibility, and type.

The current model is not sufficient for the final workflow because:

- `Adjustments` still exposes a legacy broad indexer for preset and copy-paste
  compatibility.
- `SubMask.parameters` is a legacy dynamic bag instead of a discriminated per
  mask parameter shape.
- Masks are not yet owned by graph-native layers with stable command IDs.
- The current UI can organize mask containers, but the final renderer contract
  must know layer order, blend mode, opacity, visibility, mask operations,
  adjustment payloads, history, provenance, and invalidation.
- API and app-server tools need the same command surface as the UI.

## Fixture Corpus

Issue #1896 reserves the first layer/mask RAW corpus placeholders:

- `real.layers.mask-refinement-portrait.v0`
- `real.layers.local-adjustment-landscape.v0`
- `raw-evidence.layers.mask-refinement-portrait.v1`

These entries are schema/metadata only. They do not add RAW payloads, mask
ground truth, rendered pixels, or runtime quality claims. A later PR must attach
approved rights, hashes, source metadata, mask/reference artifacts, and
preview/export proof before they can count as runtime layer or mask evidence.

## Product Model

The layer stack is ordered top to bottom in the UI and evaluated bottom to top in
the render graph. Each layer has:

- Stable ID.
- User-visible name.
- Enabled state.
- Visibility state.
- Opacity from 0 to 1.
- Blend mode.
- Optional mask graph.
- Ordered layer-scoped adjustment list.
- Optional derived artifact reference for merge, retouch, AI, or rasterized mask
  outputs.
- Provenance metadata for actor, command ID, source image revision, and tool
  version.

The base RAW decode remains the immutable base image for the edit graph. Global
edits are graph nodes below the local layer stack unless an operation explicitly
states a different placement. HDR, panorama, focus stack, super-resolution, AI,
and generated-positive outputs enter the graph as derived artifact layers with
provenance and invalidation rules.

## UX Workflow

The first usable layer panel should support:

- Create empty adjustment layer.
- Rename layer.
- Toggle visibility.
- Toggle enabled state.
- Adjust opacity.
- Reorder layer.
- Duplicate layer.
- Delete layer.
- Add mask to layer.
- Add, subtract, or intersect mask operations.
- Invert mask.
- Show mask overlay.
- Attach supported adjustment groups to a layer.
- Copy and paste layer settings within one image.

The UI should keep high-frequency controls visible and avoid nested-card layouts:

- Layer rows use compact scan-friendly rows with icon controls for visibility,
  enablement, mask presence, duplicate, delete, and more actions.
- Opacity is a slider or numeric input in the selected-layer inspector.
- Blend mode is a menu.
- Mask composition is a nested but compact operation list inside the selected
  layer inspector.
- Mask overlay controls use segmented buttons or icon toggles.
- Layer state changes must not resize rows or shift the stack.

## Blend Modes

Phase 1 exposes only blend modes that have deterministic math and a clear color
space policy:

- `normal`
- `multiply`
- `screen`
- `overlay`
- `soft_light`
- `color`
- `luminosity`
- `hue`
- `saturation`

All blend modes must declare their working color space. Final implementation
should evaluate blend math in the selected scene-linear or perceptual domain
defined by the color pipeline ADRs, not ad hoc display RGB.

## Mask Model

Masks are graph operations, not direct UI-only overlays. Every mask operation
has:

- Stable ID.
- Type discriminator.
- Composition mode: add, subtract, or intersect.
- Opacity.
- Invert flag where meaningful.
- Coordinate space.
- Geometry revision dependency.
- Optional source artifact dependency.
- Typed parameters.

Initial operation types:

- Brush stroke.
- Eraser stroke.
- Linear gradient.
- Radial gradient.
- Luminance range.
- Color range.
- AI subject.
- AI sky.
- AI background.
- AI foreground.

Later operation types:

- Depth range.
- Object select.
- People.
- Face.
- Skin.
- Eyes.
- Lips.
- Hair.
- Clothes.
- AI edge refine.

Dynamic masks must record their generator, model version, prompt or selection
input where applicable, image revision, and confidence summary. Rasterized masks
must record the source dynamic operation and invalidation dependency.

## Adjustment Scope

Layer-scoped adjustments should reuse the same typed operation families as global
adjustments when possible. The command envelope decides whether an operation is
global or layer-scoped through an explicit target:

- `target.kind = "global"`
- `target.kind = "layer"`
- `target.kind = "mask"`
- `target.kind = "artifact"`

Layer-scoped adjustments are applied after the layer mask resolves and before
blend compositing unless a specific operation declares another placement. Color
range masks and selective color tools must be able to share range math without
duplicating untyped payloads.

## Command Surface

Every layer action must have a command equivalent:

- `layer.create`
- `layer.rename`
- `layer.setEnabled`
- `layer.setVisible`
- `layer.setOpacity`
- `layer.setBlendMode`
- `layer.reorder`
- `layer.duplicate`
- `layer.delete`
- `layer.copySettings`
- `layer.pasteSettings`
- `layer.attachAdjustment`
- `layer.detachAdjustment`
- `mask.create`
- `mask.update`
- `mask.reorder`
- `mask.setMode`
- `mask.setVisible`
- `mask.setOpacity`
- `mask.invert`
- `mask.delete`
- `mask.rasterize`
- `mask.recompute`

Commands must include `expectedGraphRevision`, actor metadata, dry-run support,
and typed errors. App-server tools should call these commands rather than
mutating UI state directly.

## Sidecar And Replay

The sidecar stores the graph-native layer stack, not a UI snapshot. Replay must
be deterministic across:

- UI save and reload.
- Command log replay.
- Headless validation.
- App-server tool invocation.
- Future migration from legacy RapidRaw adjustment snapshots.

Schema migrations must preserve unknown future graph nodes only when they can be
roundtripped safely. Otherwise validation must fail with a typed unsupported
schema error.

## Validation Gates

Minimum gates before a runtime layer feature can merge:

- Zod schema parse tests for layer and mask payloads.
- JSON sample validation through `packages/rawengine-schema`.
- Command reducer tests for create, update, reorder, duplicate, delete, undo, and
  redo.
- Sidecar roundtrip tests.
- Mask composition fixtures for add, subtract, and intersect.
- CPU reference mask evaluation for deterministic synthetic cases.
- GPU and CPU parity tests once GPU evaluation is connected.
- Overlay coordinate roundtrip tests for crop, rotate, zoom, brush, and gradient
  placement.
- UI smoke for layer stack keyboard and pointer workflows.
- App-server tool schema drift check once tools are exposed.
- Unsafe cast check, with no `as any` and no `as unknown as`.

## PR Sequence

Recommended small PR sequence for issues #108 through #121:

1. #108: document this final UX and graph workflow model.
2. #109: add polished but non-destructive layer stack UI shell backed by fixture
   state.
3. #110: add graph operations for opacity, visibility, reorder, duplicate, and
   delete.
4. #111: add per-layer adjustment targeting and schema samples.
5. #112: replace brush and eraser parameter bags with typed schemas.
6. #113: add linear and radial gradient schemas, fixtures, and UI controls.
7. #114: add luminance range mask schemas and synthetic fixtures.
8. #115: add color range mask schemas sharing selective color range math.
9. #116: add deterministic add, subtract, and intersect composition fixtures.
10. #117: add feather, density, edge refine, mask blur, and contrast controls.
11. #118: add overlay modes and coordinate validation.
12. #119: add copy and paste with geometry remapping policy.
13. #120: audit current subject, sky, and background AI masks for migration.
14. #121: research people and parts masks and define blocked validation criteria.

## Accepted Gaps

This issue is complete when the workflow contract is merged and linked from the
plan. Runtime layer application remains future work. The first runtime PR should
not close #110 or #111 until layer operations can be replayed and validated
outside the UI.
