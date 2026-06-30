# RapidRAW GPU And Shader Baseline

- Snapshot date: 2026-06-11
- Issue: #60 `audit(gpu): document current GPU and shader pipeline`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-gpu`
- Baseline branch at capture: `codex/docs-gpu-baseline`
- Baseline commit: `c1e5e91`

## Purpose

This document records the current RapidRAW GPU, WGPU display, shader, preview, and
cache architecture before RawEngine changes color, layer, or performance behavior.
It is a static audit of the existing code. It does not define a target design.

## Inspected Surface

Primary backend files:

- `src-tauri/src/gpu/gpu_processing.rs`
- `src-tauri/src/shaders/shader.wgsl`
- `src-tauri/src/shaders/blur.wgsl`
- `src-tauri/src/shaders/flare.wgsl`
- `src-tauri/src/shaders/display.wgsl`
- `src-tauri/src/app/state.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/src/render/image_processing.rs`
- `src-tauri/src/app/settings.rs`
- `src-tauri/src/io/cache_utils.rs`
- `src-tauri/src/io/image_loader.rs`
- `src-tauri/src/render/mask_generation.rs`
- `src-tauri/src/export/export_processing.rs`

Primary frontend files:

- `src/hooks/useImageProcessing.ts`
- `src/hooks/useTauriListeners.ts`
- `src/hooks/useImageLoader.ts`
- `src/components/panel/Editor.tsx`
- `src/components/panel/editor/ImageCanvas.tsx`
- `src/components/panel/SettingsPanel.tsx`

## Top-Level Architecture

RapidRAW uses WGPU for the main adjustment renderer. The primary rendering path is
not a CPU pipeline with optional GPU acceleration. `apply_adjustments` sends work
to a preview worker, that worker initializes a `GpuContext`, builds or reuses a
`GpuProcessor`, uploads the transformed preview image as an `Rgba16Float` texture,
dispatches WGPU compute shaders, and either reads back JPEG bytes for the frontend
or presents the result through a native WGPU surface.

There are two distinct GPU concepts:

- GPU compute: always used by the current adjustment preview and export rendering
  calls that use `process_and_get_dynamic_image`.
- WGPU direct display: optional native surface presentation that bypasses JPEG
  readback for the editor preview when `use_wgpu_renderer` is enabled and a WGPU
  surface exists.

The CPU still performs image loading, RAW/default preprocessing, geometry
transforms, patch compositing, mask bitmap generation, histogram/waveform analysis,
JPEG encoding, and some fallback thumbnail/preview behavior. For normal editor
adjustment rendering, however, there is no complete CPU replacement path visible in
the audited code. If GPU preview processing fails, `process_preview_job` returns an
error instead of rendering the same adjustments on CPU.

## WGPU Context And Display Setup

`get_or_init_gpu_context` owns lazy WGPU initialization. It stores the resulting
`GpuContext` in `AppState.gpu_context`, so later calls reuse the same device,
queue, limits, and optional display state.

Initialization behavior:

- The WGPU instance is created from environment-derived configuration.
- On Windows, when `WGPU_BACKEND` is unset, the instance uses
  `wgpu::Backends::PRIMARY`.
- The app settings field `processing_backend` is applied during Tauri setup by
  setting `WGPU_BACKEND` when the value is not `auto`.
- A `.gpu_init_crash_flag` file is written before GPU initialization and removed
  after successful device creation. If that flag exists on the next app start,
  setup logs a previous GPU driver crash and sets `processing_backend` to `gl`.
- Adapter selection requests `HighPerformance` and uses the WGPU surface as the
  compatible surface when one exists.
- `TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES` is requested only if supported by the
  adapter.
- The device is requested with adapter limits and `MemoryHints::Performance`.

Native WGPU display setup is platform- and setting-dependent:

- On Linux and Android, `surface_opt` and the display are always `None`.
- On other platforms, `use_wgpu_renderer` defaults to true and controls whether
  `instance.create_surface(window)` is attempted.
- If surface creation fails, the context continues as compute-only.
- The display swapchain chooses the first non-sRGB format when available, uses
  `PresentMode::Fifo`, and selects an opaque/premultiplied/postmultiplied alpha
  mode based on capabilities.
- The display pipeline uses `shaders/display.wgsl`, a uniform
  `DisplayTransform`, the processed output texture, and a filtering sampler.

Window resize handling updates the display surface configuration and re-renders
the current bind group when a display exists.

## App State

GPU and preview state lives in `AppState`:

- `gpu_context`: cached WGPU device, queue, limits, and optional display.
- `gpu_image_cache`: cached uploaded input texture for the current transformed
  preview image.
- `gpu_processor`: cached `GpuProcessor` with reusable working textures sized to
  at least the current image dimensions.
- `cached_preview`: CPU-side transformed preview bases for full and interactive
  preview resolutions.
- `full_warped_cache` and `full_transformed_cache`: CPU-side geometry/patch
  caches for full-resolution transform work.
- `mask_cache`: generated grayscale mask bitmaps keyed by mask definition,
  render size, scale, and crop offset.
- `lut_cache`: parsed LUT files held as `Arc<Lut>`.
- `preview_worker_tx` and `analytics_worker_tx`: background worker channels for
  coalesced preview and histogram/waveform work.

Loading a new image clears the original image, preview cache, GPU image cache,
full warped/transformed caches, mask cache, patch cache, geometry cache, and modal
result caches. `clear_image_caches` clears decoded image, GPU image, preview,
warped, and transformed caches. `clear_session_caches` clears patch, mask, and
geometry caches only.

## Preview Flow

Frontend `useImageProcessing` invokes `apply_adjustments` with:

- prepared adjustment JSON;
- `isInteractive`, which is true for dragging/live updates;
- optional target preview resolution;
- optional normalized ROI;
- waveform options.

The backend `apply_adjustments` command submits a `PreviewJob` to a single preview
worker thread. The worker drains queued jobs before rendering, so it processes the
latest pending preview request and drops older superseded work.

`process_preview_job` then:

1. Initializes or reuses the WGPU context.
2. Hydrates adjustments and reads the currently loaded image.
3. Computes a transform hash from adjustments.
4. Loads settings for preview resolution, live preview quality, and direct WGPU
   display enablement.
5. Generates or reuses a transformed preview base, clearing `gpu_image_cache`
   when the base changes.
6. Builds a smaller interactive preview image when live preview quality requires
   downscaling.
7. Converts normalized ROI to preview pixel coordinates only for interactive
   jobs.
8. Generates mask bitmaps for visible masks.
9. Parses adjustments into the packed GPU `AllAdjustments` struct.
10. Loads a cached parsed LUT if `lutPath` is present.
11. Calls `process_and_get_dynamic_image_with_analytics`.

After GPU processing:

- If direct WGPU display is enabled, the backend polls briefly, emits
  `wgpu-frame-ready`, and returns the sentinel bytes `WGPU_RENDER`.
- If direct WGPU display is disabled, the backend reads back an `Rgba8` image,
  encodes it as JPEG, and returns bytes to the frontend.
- Interactive non-WGPU responses prepend a 24-byte ROI header:
  `x`, `y`, `width`, `height`, full preview width, and full preview height as
  little-endian `u32`, followed by JPEG data.
- Full non-WGPU responses return only JPEG data.

The analytics path is intentionally separate from display. When direct WGPU output
skips CPU readback but analytics are requested, the backend copies the processed
region into a map-read buffer and spawns a thread to read it back for
histogram/waveform workers.

## ROI Behavior

Frontend ROI is calculated from the visible image intersection during zoomed
interactive updates. It is omitted when scale is near 1.0, when there is no
intersection, or when the clamped ROI covers effectively the full image.

Backend ROI behavior:

- ROI is accepted only for interactive preview jobs.
- The ROI is converted from normalized frontend coordinates into pixel bounds in
  the currently selected processing image.
- GPU tile iteration is limited to tiles intersecting the ROI.
- Non-WGPU interactive responses return only the processed ROI as a JPEG patch and
  include the ROI header so the frontend can place it over the previous preview.
- Direct WGPU display uses the ROI to update the corresponding region of the
  working/output textures. The full native surface still displays through the
  current display transform.
- Analytics are skipped for interactive ROI jobs.

## GPU Processor

`GpuProcessor` owns the reusable shader pipelines, bind group layouts, uniforms,
and textures used by the compute renderer.

Persistent resources include:

- horizontal and vertical blur compute pipelines from `blur.wgsl`;
- flare threshold and flare ghost pipelines from `flare.wgsl`;
- main adjustment compute pipeline from `shader.wgsl`;
- adjustment storage buffer;
- blur parameter and flare parameter uniform buffers;
- dummy blur and LUT views for inactive bindings;
- reusable `Rgba16Float` ping-pong/blur textures;
- `Rgba8Unorm` tile, working, and output textures.

Processor allocation is size-based:

- `process_and_get_dynamic_image_inner` creates a new processor when none exists
  or when the current image exceeds the cached processor dimensions.
- New dimensions are rounded up to 256-pixel boundaries.
- When reallocating, the old full output texture is copied into the new output
  texture over the overlapping region and the display bind group is migrated.
- The processor is not shrunk for smaller images during the audited path.

Image input caching is keyed by transform hash, width, and height:

- If any of those values differ, `gpu_image_cache` is discarded.
- On cache miss, the transformed preview/base image is converted to `Rgba16Float`
  and uploaded as the input texture.
- The cache relies on load/cache invalidation to separate different images.

GPU bounds handling:

- If the transformed image exceeds `limits.max_texture_dimension_2d`,
  `process_and_get_dynamic_image_inner` logs a warning and returns an unprocessed
  clone of the base image. This is a guard against crashes, not an equivalent CPU
  adjustment fallback.

## Tiling And Intermediate Passes

The main compute renderer uses fixed tiling:

- `TILE_SIZE` is 2048.
- `TILE_OVERLAP` is 128.
- Blur input regions include overlap around each tile.
- Output copies crop away the overlap and write only the requested tile or ROI
  region.

For each intersecting tile, the renderer currently runs four separable Gaussian
blur passes:

- sharpness blur radius base `1.0`;
- tonal blur radius base `3.5`;
- clarity blur radius base `8.0`;
- structure blur radius base `40.0`.

The base blur radius is scaled by `min(width, height) / 1080.0` and rounded up.
These blur textures are then bound into the main shader regardless of which
individual controls are active.

If global flare amount is greater than zero, a separate 512 x 512 flare map is
generated before tile processing:

- `threshold_main` samples the input, applies exposure/brightness/whites logic,
  and writes bright contribution into a threshold texture.
- `ghosts_main` builds starburst, glow, ghost, halo, and streak components into a
  flare texture.
- The main shader samples the generated flare texture in image UV space.

## Main Shader

`shader.wgsl` is a monolithic compute shader with `@workgroup_size(8, 8, 1)`. It
writes `rgba8unorm` output and expects:

- `Rgba16Float` input texture;
- `Rgba8Unorm` storage output texture;
- packed `AllAdjustments` storage buffer;
- `R8Unorm` 2D texture array of masks;
- optional 3D `Rgba16Float` LUT texture;
- sharpness, tonal, clarity, and structure blur textures;
- optional flare texture and filtering sampler.

The shader includes:

- sRGB/linear conversion helpers;
- HSV/HSL helpers;
- chromatic aberration correction;
- tonal adjustments for exposure, brightness, contrast, highlights, shadows,
  whites, and blacks;
- temperature/tint, saturation, vibrance, HSL panel, color calibration, and color
  grading;
- luma and RGB curves;
- luma and color noise reduction;
- sharpness, clarity, dehaze, structure, center/vignette, grain, glow, halation,
  flare, clipping display, LUT application, and tonemapping;
- AgX, legacy/basic, and no-tonemap branches.

Mask behavior:

- `MAX_MASKS` is represented in WGSL as an array of 32 mask adjustments.
- Visible masks are packed into `mask_adjustments`; invisible masks are filtered
  out before upload.
- The Rust bind layout uses one mask texture array binding.
- Mask influence is sampled per pixel with `textureLoad(mask_textures, coords,
mask_index, 0)`.
- The shader first accumulates several scalar/global controls with mask influence,
  then applies some mask-specific color grading and curve effects later in the
  pipeline.

LUT behavior:

- Parsed LUT data is cached on CPU by path, but the 3D WGPU LUT texture is created
  inside each processor run when a LUT is present.
- LUT data is uploaded as `Rgba16Float`.
- The shader samples the LUT with tetrahedral interpolation implemented through
  explicit `textureLoad` calls.

## Blur Shader

`blur.wgsl` implements two compute entry points:

- `horizontal_blur` with `@workgroup_size(256, 1, 1)`;
- `vertical_blur` with `@workgroup_size(1, 256, 1)`.

The horizontal pass samples the full input texture using absolute coordinates
derived from tile offsets and writes to the tile-sized ping-pong texture. The
vertical pass samples the intermediate texture in local tile coordinates and
writes to the selected blur output texture. Sample values are clamped to the
representable f16 maximum before accumulation.

## Flare Shader

`flare.wgsl` implements:

- `threshold_main` for bright-source extraction into a 512 x 512 threshold map;
- `ghosts_main` for generated starbursts, radial glow, iris pattern, ghosts,
  halos, and streaks.

The flare path is global rather than per-tile. It downsamples/samples the full
input into a fixed flare map and later composites by sampling this map from the
main shader.

## Display Shader And Frontend Presentation

`display.wgsl` is a render pipeline, not a compute pipeline. It draws a four-vertex
triangle strip and maps the current processed output texture into window space.

`DisplayTransform` contains:

- image rect in physical screen coordinates;
- clipping rect;
- window size;
- logical image size;
- backing texture size;
- pixelated flag;
- primary and secondary background colors.

The frontend `Editor.tsx` runs a `requestAnimationFrame` loop that:

- reads the editor image container bounds;
- converts positions and sizes to device-pixel coordinates;
- computes a clip rectangle with a small overlap;
- sends a hidden offscreen transform when WGPU is disabled, the image is not
  ready, the first native frame has not rendered, or the crop view is active;
- sends the current pan/zoom/image transform when WGPU is active;
- enables pixelated sampling near max zoom.

The backend `update_wgpu_transform` updates the uniform buffer and immediately
calls `display.render`.

Frontend display selection:

- `useTauriListeners` listens for `wgpu-frame-ready` and marks
  `hasRenderedFirstFrame` for the selected path.
- `useImageProcessing` treats returned `WGPU_RENDER` bytes as a sentinel and does
  not create a blob URL.
- `ImageCanvas` suppresses the normal SVG image layers and interactive JPEG patch
  layer when WGPU is active.
- Original-image overlay, crop view, mask overlay, Konva mask controls, and
  white-balance sampling remain DOM/canvas-driven overlays.

## CPU Work Around The GPU Path

CPU work remains important around the GPU renderer:

- image decode and RAW loading happen before GPU upload;
- default RAW preprocessing can run on CPU before geometry/mask paths;
- AI patches are composited into the base image on CPU before preview generation;
- geometry transforms and preview downscaling are CPU-side before GPU adjustment
  rendering;
- mask bitmaps are generated on CPU and uploaded as an `R8Unorm` texture array;
- JPEG encoding is CPU-side for non-WGPU previews;
- histogram and waveform analysis are CPU-side after readback;
- exports call the same GPU processor and then encode/save CPU-side;
- thumbnails and some fallback preview paths can fall back to CPU preprocessing if
  GPU processing is unavailable, but this is not the main editor adjustment path.

## Cache Behavior

Current cache layers:

- `DecodedImageCache`: LRU-style decoded image/exif cache with settings-controlled
  capacity.
- `cached_preview`: transformed preview base, smaller interactive base, transform
  hash, scale, crop offset, preview dimension, and interactive divisor.
- `gpu_image_cache`: uploaded `Rgba16Float` texture for the transformed preview
  base keyed by transform hash and dimensions.
- `gpu_processor`: reusable pipelines and oversized textures keyed by minimum
  required dimensions.
- `full_warped_cache`: full-resolution warped image keyed by geometry hash.
- `full_transformed_cache`: full-resolution transformed image keyed by transform
  hash.
- `mask_cache`: generated mask bitmap cache, cleared when more than 50 entries are
  accumulated.
- `lut_cache`: parsed LUT cache by path.

Notable invalidation facts:

- Loading an image clears all preview/GPU/session caches relevant to the editor.
- A changed transformed preview base clears `gpu_image_cache`.
- A changed interactive divisor with the same base also clears `gpu_image_cache`
  for interactive jobs.
- `gpu_processor` persists across images and can grow to fit larger images.
- Parsed LUTs are cached, but GPU LUT textures are recreated per run.
- Mask GPU textures are recreated per run from CPU mask bitmaps.

## Settings And Platform Selection

User-facing settings include:

- `processing_backend`: defaults to `auto`; non-auto values set `WGPU_BACKEND`.
- `use_wgpu_renderer`: controls direct WGPU display, not GPU compute.
- `linux_gpu_optimization`: can set WebKit/DMABUF/compositing-related environment
  variables on Linux.
- preview resolution and live preview quality settings that affect CPU preview
  base size and interactive downscaling.

Defaults and UI constraints:

- `use_wgpu_renderer` defaults to false on Linux and Android.
- `use_wgpu_renderer` defaults to true on other platforms.
- The settings UI disables the WGPU direct-render switch on Linux and Android.
- i18n strings describe Linux as disabled because GTK webviews conflict with WGPU
  on the same X11 surface, and Android as disabled because native WGPU surface
  creation is not supported with the mobile webview.

## Risks And Gaps For Future Work

These are factual risks and gaps in the current baseline, not implementation
recommendations:

- Main editor adjustment rendering has no equivalent CPU fallback path in the
  audited `apply_adjustments` flow.
- The oversized `GpuProcessor` is retained and grows but does not shrink during
  the audited path.
- The main WGSL shader is monolithic and encodes color, tone, mask, effects,
  curves, LUT, and display-clipping concerns in one compute entry point.
- CPU and GPU color/tonemap/preprocessing logic coexist in multiple places, which
  raises parity risk for future color changes.
- Four blur prepasses run for every processed tile, even when related controls may
  be inactive.
- LUT parsing is cached, but WGPU LUT texture upload is repeated per processor
  run.
- Mask generation is CPU-side and mask texture upload is repeated per processor
  run.
- Direct WGPU display and analytics share the same device through locks and
  thread-spawned readback work; this is a concurrency and latency area to watch.
- Direct WGPU display is unavailable by design on Linux and Android in the current
  codepath.
- WGPU surface output and DOM/Konva overlays must stay aligned through repeated
  frontend transform synchronization.
- ROI updates improve interactive cost but still depend on cache correctness,
  tile overlap, and display texture persistence.
- Layer work will need to account for the current single composited input texture,
  one mask texture array, one adjustment buffer, and one final output texture.
- Future high-bit-depth or wide-gamut color work must account for the current
  `Rgba16Float` input/intermediates but `Rgba8Unorm` main output texture.

## Current Assessment

The current RapidRAW editor path is already GPU-centric for adjustment rendering.
The optional setting named WGPU direct rendering changes presentation and readback
behavior, not whether the adjustment shader pipeline is used. Most future
RawEngine color, layer, and performance work will intersect the monolithic
`shader.wgsl` compute path, CPU-side transform/mask preparation, and cache
invalidation rules around preview bases and uploaded GPU textures.
