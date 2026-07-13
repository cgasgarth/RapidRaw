# Edit Graph Production Operation Inventory

Issue #5399 audit, updated for `scene_referred_v2`. Canonical field layout is
`src-tauri/src/adjustments/abi.rs`; parsing is centralized in
`src-tauri/src/adjustments/parse.rs`. This page records placement and production
ownership without duplicating the ABI field schema.

| Operation family | Compiled node/domain | Production implementation | Bounds/conversions | Adjustment authority |
| --- | --- | --- | --- | --- |
| RAW black/white level, bad pixels, demosaic, highlight reconstruction | camera input; sensor/camera linear → AP1 scene-linear | `raw/loader.rs`, `raw/highlight_reconstruction.rs` | sensor sanitation; camera RGB → AP1 | RAW metadata/decode plan |
| Camera profile and input matrix | camera input; camera linear → AP1 scene-linear | `color/camera_input_transform.rs` | declared matrix/chromatic adaptation | input-transform plan |
| Geometry, crop, rotate, perspective, lens distortion, patches, retouch | geometry/retouch; AP1 scene-linear | `render/image_processing.rs`, `retouch/*`, `lens_correction/*` | resampling footprint; finite sampling bounds | render plan geometry/retouch fingerprints |
| Pre-GPU resize and detail preparation | pre-GPU spatial detail; AP1 scene-linear | `render/image_processing.rs` | filter support/edge policy | typed render plan |
| CA, luma/chroma denoise, sharpening, clarity, structure | scene global/local; AP1 scene-linear | `shaders/shader.wgsl`, `render/cpu_edit_graph.rs` | AP1 luminance; algorithm-local thresholds; 64 px maximum halo | `SceneGlobalPayload`, `LocalScene` |
| Exposure, white balance, brightness, contrast, highlights, shadows, whites, blacks | scene global/local; AP1 scene-linear | `shaders/shader.wgsl`, `render/cpu_edit_graph.rs` | finite extended values preserved in v2 | `SceneGlobalPayload`, `LocalScene` |
| Dehaze, centre, glow, halation, flare, vignette | scene global/local; AP1 scene-linear | `shaders/shader.wgsl`, `shaders/flare.wgsl`, `render/cpu_edit_graph.rs` | AP1 luminance; local masks bounded; spatial auxiliaries use f16 parity surfaces | `SceneGlobalPayload`, `LocalScene` |
| Calibration, HSL, hue, saturation, vibrance | scene global/local; AP1 scene-linear | `shaders/shader.wgsl`, `render/cpu_edit_graph.rs` | negative residual preserved; HSV saturation is algorithm-local bounded state | `SceneGlobalPayload`, `LocalScene` |
| Color balance RGB, channel mixer, levels, B&W mixer | scene global; AP1 scene-linear | `color/mixer_render.rs`, `shaders/shader.wgsl`, `render/cpu_edit_graph.rs` | AP1 luminance; no v2 0..1 output clamp | `SceneGlobalPayload` |
| Color grading and masked layer blending | scene global/local composition; AP1 scene-linear | `shaders/shader.wgsl`, `render/cpu_edit_graph.rs` | mask influence bounded; same math and placement globally/locally | `SceneGlobalPayload`, `LocalScene` |
| Film emulation/look inputs | scene/look contract; AP1 scene-linear | film render-plan integration and LUT compiler | declared film/LUT ABI; no hidden JSON reparse | graph/output fingerprints; coordinated with film issues |
| Basic/AgX view transform | scene-to-view; AP1 scene-linear → view encoded | second v2 WGPU dispatch, `render/cpu_edit_graph.rs` | explicit extended transfer/view transform | `ViewTransformPayload` |
| Tone/RGB curves, creative LUT, grain | display creative; view encoded | third v2 WGPU dispatch, `render/cpu_edit_graph.rs` | view-encoded luma; tetrahedral LUT input rules; grain mask bounds | `DisplayCreativePayload`, local curve payloads |
| Clipping/gamut warning | display overlay; view encoded | `shaders/shader.wgsl`, proof/gamut modules | explicit display thresholds only | `ClippingOverlay` |
| Display profile and native presentation | output/display transform | `color/working_to_output_transform.rs`, `gpu/gpu_display.rs` | output gamut/profile conversion | view/output identity |
| Soft proof | proof/output transform | export/proof render-plan path and working-to-output transform | proof profile + intent identity | canonical compiled graph plus declared target |
| Export encoding/profile | output transform; view/output → transport encoded | `export/export_processing.rs` | final gamut mapping, transfer, and quantization bounds | canonical compiled graph plus export target |
| Thumbnail, smart preview, preset/film thumbnail | declared graph consumer/truncation | `library/file_management.rs`, preview/export helpers | same graph version and fingerprint; scale is explicit | canonical compiled graph |
| Batch/computational render | declared graph consumer | native commands and export processing | same validation/currentness contract | canonical compiled graph |

## Exact adjustment-payload ownership

The renderer parses the revision once. The graph captures an immutable shader
transport snapshot, while executable ownership is split into payloads matching
the physical domains below. A request-side ABI mutation after compilation is
rejected before CPU or WGPU execution.

| Owned payload | Exact adjustment families | Physical phase |
| --- | --- | --- |
| `SceneGlobalPayload` | exposure; brightness; contrast; highlights; shadows; whites; blacks; saturation; temperature; tint; vibrance; hue; sharpness + threshold; luma/chroma NR; clarity; dehaze; structure; centre; CA red/cyan + blue/yellow; glow; halation; flare; vignette; calibration; color-balance RGB; channel mixer; B&W mixer; levels; eight HSL bands; four grading wheels + blending/balance | AP1 scene-global dispatch |
| `LocalScenePayload` | per-layer exposure/basic tone; WB; saturation/vibrance/hue; detail/NR; glow/halation/flare; eight HSL bands; four grading wheels; blend mode | AP1 local composition in the scene dispatch |
| `ViewTransformPayload` | tone-mapper mode; RAW/non-RAW behavior; AgX pipe/rendering matrices | scene-to-view dispatch |
| `DisplayCreativePayload` | global and per-layer luma/R/G/B curves; LUT enabled/intensity; grain amount/size/roughness; per-layer blend mode | view-encoded display dispatch |
| `ClippingOverlay` | clipping-warning enable | display dispatch |
| `RenderTransport` | view/output identity, absolute-coordinate dither, final transport | display/output dispatch |

Geometry, retouch, pre-GPU detail, camera input, proof profiles, and export
profiles remain owned by their dedicated typed render-plan artifacts rather
than being duplicated into the adjustment ABI.

## Clamp and conversion policy

- Scene v2 preserves finite negative and over-one values. Sanitizing non-finite
  input, mask weights, interpolation coordinates, hue/saturation coordinates,
  and algorithm thresholds are local mathematical bounds, not signal clamps.
- AP1 scene operations call `scene_luminance`; display curves/grain call
  `view_encoded_luma`. The regression guard rejects ambiguous `get_luma`.
- The physical v2 dispatch chain is scene-linear intermediate → view-encoded
  intermediate → display/output result. All three dispatches share one command
  buffer and one queue submission per tile.
- Legacy v1 remains one compatibility dispatch with implementation-defined
  historic clamps and conversions; it is never silently upgraded.

## Cache and execution identity

Each node owns a typed payload and payload fingerprint. Graph, source,
geometry, retouch, detail, view, and output identities feed artifact caches.
The runtime GPU receipt reports phase/blur dispatches, command buffers, queue
submissions, cache hit/miss deltas, CPU encode/wall timing, domain conversions,
declared clamp classes, and peak-resource estimate.

## Performance evidence

The native benchmark matrix covers 24 MP (6000×4000), 45 MP (8256×5504), and
100 MP (11664×8576) plans for default, tonal, complex grading/HSL, 5-mask,
20-mask, film/LUT, and proof/export edits.
It asserts identical v1/v2 peak-resource estimates because v2 reuses existing
RGBA16F transport surfaces, checks distinct versioned execution identities,
and runs 1,000 compiles per workload/dimension. Runtime Metal tests separately
assert three physical phase dispatches in one command buffer/submission,
cache-hit/miss deltas, encode/wall timing, conversion/clamp receipts, sparse
blur reuse, and CPU/WGPU stage parity. The private 24 MP Alaska proof exercises
the same compiled graph through production RAW preview and export; private
inputs and outputs are not checked in.
