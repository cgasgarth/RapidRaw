# RapidRAW Architecture Baseline

- Snapshot date: 2026-06-11
- Issue: #57 `audit(architecture): document current RapidRAW architecture`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-architecture`
- Baseline branch at capture: `codex/docs-architecture-baseline`

## Purpose

This document records the current RapidRAW application architecture before
RawEngine architecture work changes the app structure. It is intentionally
factual: it describes the current React/Tauri boundaries, Rust module
responsibilities, command/data flow, persistence shape, image pipeline, AI hooks,
and architecture risks visible from the current code.

## Runtime Shape

RapidRAW is a Tauri 2 desktop application with a React/TypeScript frontend and a
Rust backend.

- Frontend entry: `src/main.tsx`.
- Main React shell: `src/App.tsx`.
- Global styles: `src/styles.css`.
- Tauri backend entry: `src-tauri/src/main.rs`, which calls `RapidRAW_lib::run()`.
- Main Rust app builder and command registration:
  `src-tauri/src/lib.rs`.
- Tauri configuration: `src-tauri/tauri.conf.json`.

The frontend is built with Vite and React 19. State is held mainly in Zustand
stores. Backend calls use Tauri `invoke(...)` commands and Tauri event listeners.
The Rust backend owns file IO, image decoding and rendering, metadata sidecars,
exports, thumbnail generation, AI model execution, AI connector calls, and Tauri
window/runtime setup.

## Frontend Entry Points And Boundaries

`src/main.tsx` installs the frontend log bridge, creates the React root, and
renders `<App />` under `React.StrictMode`.

`src/App.tsx` is the main composition and orchestration layer. It wires together:

- Tauri window state, startup readiness, app context menus, keyboard shortcuts,
  and Tauri event listeners.
- Library navigation and selection handlers.
- Editor navigation and selected-image lifecycle.
- Shared refs for preview job ordering, backend readiness, render resolution,
  cached edit state, and previous adjustment snapshots.
- The major layout surfaces: title bar, folder tree, library view, editor view,
  export panel, modals, tooltip layer, and hidden manager components.

The visible app is split into two main view components:

- `src/components/views/LibraryView.tsx` renders the library/community surface,
  main image grid/list, library bottom bar, import/export controls, ratings,
  thumbnail settings, and selection actions.
- `src/components/views/EditorView.tsx` renders the editor canvas, filmstrip,
  right-side panel switcher, adjustment/metadata/crop/mask/AI/preset/export
  panels, and compact portrait/mobile layout variants.

Editor rendering is centered on `src/components/panel/Editor.tsx`, which owns
canvas interaction state, crop overlays, zoom/pan gestures, mask overlays,
toolbar behavior, history controls, and WGPU transform synchronization.

Two manager components exist only to mount hook-driven side effects:

- `src/components/managers/ImageLoaderManager.tsx` mounts `useImageLoader`.
- `src/components/managers/ImageProcessingManager.tsx` mounts
  `useImageProcessing`.

## Frontend Stores

The current store boundary is by UI concern, not by backend domain.

| Store                           | Primary responsibility                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/store/useSettingsStore.ts` | Loaded app settings, selected theme, supported file types, OS platform, and saving settings through `save_settings`.                                                      |
| `src/store/useLibraryStore.ts`  | Root folders, current folder, folder trees, pinned folders, albums, image list, ratings, multi-selection, sorting, filtering, search, and library loading state.          |
| `src/store/useEditorStore.ts`   | Selected image, adjustments, edit history, preview URLs, histogram/waveform, zoom/display state, crop/rotation/white-balance tools, masks, AI patch state, and clipboard. |
| `src/store/useUIStore.ts`       | Current view, fullscreen/layout flags, panel dimensions, active right panel, modal state, and custom Escape handling.                                                     |
| `src/store/useProcessStore.ts`  | Export/import progress, thumbnail progress and cache, indexing progress, AI model download status, copied file paths, and initial file-open path.                         |

Common orchestration hooks include:

- `useAppInitialization`: loads settings and supported file types, initializes
  language/theme/UI defaults, restores pinned/root folders, and preloads folder
  trees/images when possible.
- `useAppNavigation`: opens folders, selects folders/albums/images, restores
  sessions, and cancels thumbnail generation on navigation.
- `useImageLoader`: loads metadata early from sidecars, loads the selected image
  through Rust, sets dimensions/exif/readiness, and clears session caches.
- `useImageProcessing`: debounces adjustment changes, calls `apply_adjustments`,
  manages high-resolution zoom previews, persists adjustment changes through
  `save_metadata_and_update_thumbnail`, and applies deltas to multi-selected
  images.
- `useTauriListeners`: subscribes to backend events for thumbnails, previews,
  histogram/waveform, indexing, import/export, denoise, WGPU frames, panorama,
  HDR, culling, and initial file-open events.
- `useAiMasking`: calls AI mask and generative-replace commands, obtains Clerk
  auth tokens for cloud generation, and updates masks/AI patches in the editor
  adjustment state.

## Tauri/Rust Module Boundaries

`src-tauri/src/lib.rs` is both the main backend app builder and a large command
module. It registers plugins, sets runtime environment variables, initializes
logging, starts preview/analytics/thumbnail workers, loads settings, loads the
lensfun database, pre-initializes WGPU where supported, creates the main window,
manages window persistence, constructs `AppState`, and registers the Tauri
command surface.

Important Rust modules and current responsibilities:

| Module                                      | Current responsibility                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app/state.rs`                              | Shared backend state: loaded image, caches, GPU state, AI state, worker senders, task handles, and results.                                      |
| `app/settings.rs`                           | Settings schema/defaults, copy/paste adjustment keys, settings load/save under Tauri app data.                                                   |
| `file_management.rs`                        | Folder scans, image listing, thumbnails, sidecar metadata writes, ratings/color labels/tags, albums, file ops, import, virtual copies, XMP sync. |
| `image_loader.rs`                           | Load source images, decode RAW/non-RAW images, apply orientation, composite AI patches, and populate decoded-image cache.                        |
| `raw_processing.rs`                         | RAW development through `rawler` and fast demosaic scaling helpers.                                                                              |
| `image_processing.rs`                       | Adjustment parsing, geometry/crop/flip/rotation, raw defaults, tonemapping, histogram/waveform, auto adjustments, and CPU image helpers.         |
| `gpu_processing.rs`                         | WGPU context, shader-backed adjustment rendering, display rendering, ROI reads, and GPU/CPU result extraction.                                   |
| `mask_generation.rs`                        | Mask definitions, sub-mask bitmap generation, mask overlay generation, warped mask image resolution, and mask cache.                             |
| `ai_processing.rs`                          | Local ONNX model loading/downloading and execution for SAM, sky, foreground, depth, LaMa, CLIP, and AI denoise.                                  |
| `ai_commands.rs`                            | Tauri commands for AI masks, precompute, connector status, and generative replace routing.                                                       |
| `ai_connector.rs`                           | HTTP client for external/cloud inpaint services, source upload, health check, and response compositing.                                          |
| `export_processing.rs`                      | Batch export, output encoding, resize/watermark/mask export/LUT export, export progress events, and cancellation.                                |
| `exif_processing.rs`                        | EXIF extraction, metadata embedding, sidecar EXIF migration, and `.rrdata`/legacy `.rrexif` handling.                                            |
| `tagging.rs` and `tagging_utils/*`          | AI/color tag generation, background indexing, tag hierarchy/candidate helpers, and sidecar tag updates.                                          |
| `culling.rs`                                | Batch culling analysis and progress events.                                                                                                      |
| `denoising.rs`                              | Local denoise commands, BM3D/AI denoise paths, batch denoise, and denoise result saving.                                                         |
| `panorama_stitching.rs`, `panorama_utils/*` | Panorama command flow, feature matching, homography/stitch order, seam blending, and progress events.                                            |
| `negative_conversion.rs`                    | Negative preview/conversion commands.                                                                                                            |
| `lens_correction.rs`                        | Lensfun database loading, maker/lens lookup, autodetection, and distortion parameter resolution.                                                 |
| `lut_processing.rs`                         | LUT parsing and LUT generation/conversion helpers.                                                                                               |
| `cache_utils.rs`                            | Adjustment hash helpers and cache-clear commands.                                                                                                |
| `android_integration.rs`                    | Android content URI/file integration and Android save/import helpers.                                                                            |

## Command And Event Flow

Frontend command names are centralized in the `Invokes` enum in
`src/components/ui/AppProperties.tsx`. Most frontend calls use
`invoke(Invokes.SomeCommand, payload)`, but some commands are still called as raw
strings, such as `clear_session_caches`, `update_thumbnail_queue`,
`generate_original_transformed_preview`, `update_wgpu_transform`, and several
modal preview commands.

Rust command registration is centralized in the `tauri::generate_handler![...]`
list inside `src-tauri/src/lib.rs`. Registered commands span image processing,
settings, AI, file management, thumbnails, albums, exports, tagging, culling,
lens correction, negative conversion, Android URI handling, logging, and cache
management.

Primary data flow for image editing:

1. The user selects an image in the library or filmstrip.
2. `useImageLoader` loads sidecar metadata with `load_metadata`, then calls
   `load_image`.
3. Rust parses virtual paths, loads `.rrdata` sidecar metadata, memory-maps or
   reads the source image, decodes RAW/non-RAW data, reads EXIF, and stores the
   loaded image in `AppState.original_image`.
4. Editor controls update `useEditorStore.adjustments`.
5. `useImageProcessing` sends adjustment payloads to `apply_adjustments`.
6. Rust preview workers coalesce queued preview jobs, hydrate adjustment payloads
   with cached patch data, process the image through GPU/CPU paths, and return a
   JPEG buffer or WGPU render sentinel.
7. The frontend creates blob URLs for preview buffers or waits for WGPU
   `wgpu-frame-ready`.
8. Non-interactive adjustment changes are persisted by
   `save_metadata_and_update_thumbnail`; multi-selection deltas use
   `apply_adjustments_to_paths`.
9. Backend sidecar writes and thumbnail updates emit events that refresh process
   and library store state.

Important backend-to-frontend events include:

- `preview-update-uncropped`
- `histogram-update`
- `waveform-update`
- `wgpu-frame-ready`
- `thumbnail-progress`, `thumbnail-generated`,
  `thumbnail-generation-complete`
- `indexing-started`, `indexing-progress`, `indexing-finished`
- `batch-export-progress`, `export-complete`, `export-error`,
  `export-cancelled`
- `import-start`, `import-progress`, `import-complete`, `import-error`
- `ai-model-download-start`, `ai-model-download-finish`,
  `ai-connector-status-update`
- `denoise-progress`, `denoise-complete`, `denoise-error`
- `panorama-progress`, `panorama-complete`, `panorama-error`
- `hdr-progress`, `hdr-complete`, `hdr-error`
- `culling-start`, `culling-progress`, `culling-complete`,
  `culling-error`
- `open-with-file`

## Persistence Shape

Global app settings are JSON under Tauri app data:

- `app_settings::get_settings_path` resolves `settings.json` under
  `app_handle.path().app_data_dir()`.
- Settings include recent/root folders, theme, UI visibility, filters, export
  presets, preview/cache settings, AI provider settings, XMP sync settings,
  waveform settings, keybinds, and copy/paste adjustment settings.

Other app-level persistence includes:

- Window state in `window_state.json` under Tauri app config on non-Android
  platforms.
- Presets under a Tauri app data path resolved by `file_management.rs`.
- Albums under a Tauri app data path resolved by `file_management.rs`.
- Thumbnail cache files under Tauri app cache `thumbnails/`.

Per-image edit and metadata persistence is sidecar based:

- Primary sidecars use `<source filename>.rrdata` next to the source image.
- Virtual-copy paths append `?vc=<id>` to the source path. Their sidecars use
  `<source filename>.<id>.rrdata` next to the source image.
- Legacy EXIF sidecars use `<source filename>.rrexif`; current code migrates
  legacy EXIF into the primary `.rrdata` file and removes the legacy file after a
  successful migration.
- Sidecars hold `ImageMetadata` values, including adjustments, rating, color
  label, tags, and cached EXIF where available.
- XMP sync exists for ratings, labels, and tags when enabled in settings.

There is no separate project database visible in the current architecture. The
image file path and colocated sidecar are the primary unit of persistence for
edits.

## Image Pipeline Shape

The current image pipeline is centered on a single loaded source image in
`AppState.original_image`, plus several caches keyed by source paths and
adjustment hashes.

High-level load path:

1. Frontend calls `load_metadata` to get sidecar metadata before the full image
   load completes.
2. Frontend calls `load_image` for the selected virtual or real path.
3. Rust resolves virtual-copy paths to a source path plus sidecar path.
4. Rust clears per-session image, mask, patch, geometry, preview, panorama, HDR,
   and denoise state for the new image.
5. Rust memory-maps the file when possible, falls back to regular file reads,
   decodes the image, reads or persists EXIF, and inserts decoded data into
   `decoded_image_cache`.
6. The frontend marks the selected image ready and stores dimensions, EXIF,
   loaded metadata, and initial aspect ratio.

High-level preview path:

- `apply_adjustments` sends jobs to a preview worker channel.
- The worker drains pending jobs and keeps only the latest job before processing.
- `process_preview_job` loads the current image from `AppState`, hydrates
  patch/mask data, computes transform and visual hashes, and chooses WGPU or CPU
  processing based on settings/platform.
- Interactive previews may return ROI patch buffers with geometry metadata.
- Non-interactive previews return full JPEG buffers unless the WGPU display path
  is used.
- Histogram and waveform work is offloaded to an analytics worker and returned
  through events.

High-level export path:

- Export commands process paths in batch, load sidecars, apply adjustments and
  masks, encode selected output formats, optionally preserve metadata, optionally
  export masks or LUTs, and emit batch progress/completion/error events.

Current cache layers include:

- Decoded source image cache with configurable capacity.
- Cached preview and transformed/warped image caches.
- GPU context, GPU image cache, and GPU processor state.
- LUT cache.
- Mask cache and AI patch cache.
- Geometry and thumbnail-geometry caches.
- Thumbnail disk cache.
- AI model and embedding/depth caches under `ai_state`.

## AI Hooks

The frontend has a dedicated AI/mask hook in `useAiMasking` and exposes AI work
through the editor masks/AI panels.

Current AI capabilities visible in code:

- Subject masks through SAM encoder/decoder.
- Foreground masks through U-2-Net.
- Sky masks through a sky segmentation model.
- Depth masks through Depth Anything.
- Fast local inpainting through LaMa.
- AI denoise through local model execution.
- CLIP-backed tagging/indexing.
- Generative replace through either:
  - cloud API at `https://getrapidraw.com/api` when `aiProvider` is `cloud` and a
    Clerk token is available;
  - local/external `ai-connector` HTTP service when `aiProvider` is
    `ai-connector` and `aiConnectorAddress` is set.

Model loading/downloading and model-state caches are owned by Rust
`ai_processing.rs` and `AppState.ai_state`. AI commands emit model download
events and connector status events. Generative replace builds masks through the
same mask-generation path used by normal masks, optionally unwarps geometry, then
stores generated patch color/mask data back into the adjustment payload.

## Architecture Risks And Gaps Relevant To RawEngine

These are current-state observations, not proposed designs.

- `src/App.tsx`, `src-tauri/src/lib.rs`, and `src-tauri/src/library/file_management.rs`
  are broad orchestration files with many responsibilities. Future RawEngine work
  that changes navigation, persistence, processing, or UI state is likely to
  touch these files unless boundaries are introduced first.
- The Tauri command surface is manually mirrored between the frontend `Invokes`
  enum and the Rust `generate_handler!` list, with some raw string invokes still
  present. This creates drift risk across frontend/backend command names and
  payload shapes.
- Adjustment payloads cross the Tauri boundary largely as JSON values. Rust then
  parses/hydrates fields by key. This is flexible, but many processing contracts
  are string-key based rather than enforced by a shared schema at compile time.
- The app currently treats one loaded image as the main backend editing context
  through `AppState.original_image`, with side-channel state for current caches,
  previews, AI patches, denoise/HDR/panorama results, and generation counters.
  Multi-image operations mostly reload or apply sidecar deltas per path.
- Persistence is colocated sidecar JSON, not a project/catalog database. This
  keeps edits close to files but means planned RawEngine catalog, layer, batch,
  or non-destructive history features must account for path-derived identity,
  virtual-copy path encoding, and sidecar migration behavior.
- Caches are numerous and mutable across worker threads, with a mix of `Mutex`,
  atomics, channels, task handles, and frontend job IDs. Preview correctness
  depends on coalescing, generation counters, selected-path checks, and cache
  invalidation when images or geometry change.
- Browser-only frontend rendering is not currently a reliable validation surface
  because Tauri APIs are used during startup. The existing render baseline
  records this limitation separately.
- AI functionality spans frontend auth, Rust local ONNX models, Rust HTTP
  connector calls, mask generation, patch compositing, and settings. RawEngine
  changes to AI providers or local/cloud routing need to account for all of
  those touchpoints.
- Platform-specific behavior is embedded in several places, including Android
  content URI handling, macOS file-open handling, Linux GPU environment flags,
  Windows/Linux window-state restore, and WGPU backend selection.

## Inspection Commands Used

```sh
git status --short --branch
rg --files -g '!*node_modules*'
rg -n "invoke\\(|listen\\(|emit\\(|generate_handler|manage\\(|plugin|sidecar|tauri::command" src src-tauri/src src-tauri/tauri*.conf.json
sed -n '1,320p' src/App.tsx
sed -n '1,260p' src/components/ui/AppProperties.tsx
sed -n '1,260p' src/hooks/useAppInitialization.ts
sed -n '1,260p' src/hooks/useTauriListeners.ts
sed -n '1,260p' src/hooks/useImageLoader.ts
sed -n '1,540p' src/hooks/useImageProcessing.ts
sed -n '1,260p' src/hooks/useAiMasking.ts
sed -n '1,260p' src-tauri/src/app/state.rs
sed -n '1800,2335p' src-tauri/src/lib.rs
sed -n '1,260p' src-tauri/src/library/file_management.rs
sed -n '1060,1205p' src-tauri/src/exif_processing.rs
sed -n '384,620p' src-tauri/src/ai_commands.rs
sed -n '1,180p' src-tauri/src/ai_connector.rs
```
