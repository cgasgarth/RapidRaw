# RapidRAW AI Hooks Baseline

- Snapshot date: 2026-06-11
- Issue: #62 `audit(ai): document current AI and generative hooks`
- Related issue: #208 inventory RapidRAW built-in AI features
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-ai`
- Branch: `codex/docs-ai-baseline`

## Purpose

This baseline records the current AI and generative hook surface found by static
inspection. It is intentionally factual: it inventories what exists today, where
state and payloads flow, and the migration-relevant risks or gaps for moving
built-in AI tools toward an OpenAI app server later. It does not propose an app
server design.

## Primary Code Paths Inspected

| Area                          | Files                                                                                                                        |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Local model loading/inference | `src-tauri/src/ai_processing.rs`, `src-tauri/src/ai_commands.rs`, `src-tauri/src/denoising.rs`, `src-tauri/src/tagging.rs`   |
| Mask and patch rasterization  | `src-tauri/src/render/mask_generation.rs`, `src-tauri/src/io/image_loader.rs`, `src-tauri/src/adjustment_utils.rs`                     |
| App state/settings            | `src-tauri/src/app/state.rs`, `src-tauri/src/app/settings.rs`, `src/store/useEditorStore.ts`, `src/store/useProcessStore.ts` |
| Frontend AI UI/hooks          | `src/hooks/useAiMasking.ts`, `src/components/panel/right/AIPanel.tsx`, `src/components/panel/right/Masks.tsx`                |
| Settings/auth touchpoints     | `src/App.tsx`, `src/components/panel/SettingsPanel.tsx`, `src/store/useSettingsStore.ts`                                     |
| Payload schemas               | `src/schemas/adjustmentPayloadSchemas.ts`, `src/schemas/masks/aiMaskingSchemas.ts`, `src/schemas/tauriEventSchemas.ts`             |

## Built-In AI Feature Inventory

| Feature                 | Current backend path                                                              | Frontend entry point                              | Notes                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Subject mask            | `generate_ai_subject_mask`, SAM encoder/decoder                                   | `useAiMasking.handleGenerateAiMask`               | Uses user-drawn point/box, cached image embeddings, and stores returned mask image data inside submask parameters.                     |
| Subject mask precompute | `precompute_ai_subject_mask`                                                      | `useAiMasking` effect for active `ai-subject`     | Warms SAM embeddings for the selected image/geometry hash.                                                                             |
| Foreground mask         | `generate_ai_foreground_mask`, U-2-Net                                            | `handleGenerateAiForegroundMask`; auto on add     | Runs immediately when a foreground AI edit/component is added.                                                                         |
| Sky mask                | `generate_ai_sky_mask`, sky U-2-Net                                               | `handleGenerateAiSkyMask`                         | Present in backend and mask panel types; not offered in `AI_PANEL_CREATION_TYPES` or `AI_SUB_MASK_COMPONENT_TYPES`.                    |
| Depth mask              | `generate_ai_depth_mask`, Depth Anything V2                                       | `handleGenerateAiDepthMask`                       | Present in backend and normal mask "Others" list; not offered in the AI inpainting panel creation/component lists.                     |
| Quick erase             | `generate_ai_subject_mask` followed by local fast inpaint                         | `handleQuickErase`                                | Creates/updates a `quick-eraser` submask, then invokes generative replace with `useFastInpaint: true` and an empty prompt.             |
| Basic/fast inpaint      | `get_or_init_lama_model` and `run_lama_inpainting`                                | AIPanel "use basic inpaint" switch                | Local LaMa inpainting path; used whenever `useFastInpaint` is true or no generative provider is available.                             |
| Generative replace      | `invoke_generative_replace_with_mask_def` plus cloud or `ai-connector` middleware | `handleGenerativeReplace`                         | Requires a non-fast provider path. The cloud provider uses a Clerk token; the connector provider uses a configured local HTTP address. |
| AI denoise              | `apply_denoising`/`batch_denoise_images` with method `ai` and NIND ONNX           | Denoise UI paths outside this doc's primary panel | Shares `AiState` model cache and emits denoise progress/completion events.                                                             |
| AI tagging/indexing     | `start_background_indexing` with CLIP ONNX/tokenizer                              | Library/settings tagging flows                    | Disabled by default; writes tags into `.rrdata` sidecars and can clear AI tags later.                                                  |

## App-Server Migration Coverage

`AI_APP_SERVER_TOOL_ROUTE_MANIFEST` tracks which inherited AI operations are
mapped, deferred, or intentionally outside image-editing tool calls.

| Feature                            | Route status                    | Reason                                                                                                                                                        |
| ---------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject/foreground/sky/depth masks | mapped                          | Typed dry-run/apply mask tools cover local model mask generation.                                                                                             |
| Generative replace/inpaint         | mapped                          | Typed enhancement dry-run/apply tools cover approved inpaint edits.                                                                                           |
| AI denoise                         | deferred to #1963               | The current Tauri invokes multiplex classic and AI denoise and need a denoise dry-run plan, model provenance, and artifact-writing apply path before mapping. |
| AI tagging/indexing                | outside image-edit tool surface | Tagging mutates library metadata, not image pixels; `clear_ai_tags` remains metadata cleanup.                                                                 |

## Local Model Capabilities

All local ONNX assets are downloaded into `app_data_dir()/models` and loaded
through `ort::session::Session`. `download_and_verify_model` checks SHA-256 for
most model files before loading and emits start/finish events around downloads.

| Capability        | Files downloaded                                                 | Trigger                                                                                                     |
| ----------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| SAM subject masks | `sam_vit_b_01ec64_encoder.onnx`, `sam_vit_b_01ec64_decoder.onnx` | Subject mask generation and precompute.                                                                     |
| Foreground masks  | `u2net.onnx`                                                     | Foreground AI mask generation.                                                                              |
| Sky masks         | `skyseg_u2net.onnx`                                              | Sky AI mask generation.                                                                                     |
| Depth masks       | `depth_anything_v2_vits.onnx`                                    | Depth AI mask generation.                                                                                   |
| CLIP tagging      | `clip_model.onnx`, `clip_tokenizer.json`                         | Background library indexing when `enableAiTagging` is true. The tokenizer download is not SHA-256 verified. |
| AI denoise        | `nind_denoise_utnet_684.onnx`                                    | Denoise method `ai`.                                                                                        |
| Local inpainting  | `lama_fp16.onnx`                                                 | Fast/basic inpaint and quick erase.                                                                         |

`AiState` stores loaded model sessions plus one cached SAM embedding set and one
cached depth map. Subject and depth caches are keyed by image path plus geometry
adjustment values, not by all edit adjustments.

## AI Mask Flow

AI mask parameters are persisted as submask parameter bags. Rust returns
full-mask PNG data URLs under `maskDataBase64`/`mask_data_base64` along with
rotation, flip, and coarse orientation metadata. The frontend merges those
parameters into the matching submask.

For subject masks, the frontend passes start/end coordinates, image orientation,
and transform/lens geometry adjustments. Rust generates or reuses SAM image
embeddings, unrotates/unflips the selected region, runs the decoder, and returns
a feathered mask image.

For foreground and sky masks, Rust runs full-image segmentation on the warped
image and returns a mask image. For depth masks, Rust caches a Depth Anything
map, returns it as mask data, and `mask_generation.rs` derives the active band
from `minDepth`, `maxDepth`, fade, and feather parameters.

At render time, `mask_generation.rs` decodes the stored AI mask image, applies
orientation/flip/rotation/crop transforms through `TransformParams`, applies
grow/feather controls where applicable, then combines submasks using additive,
subtractive, or intersect modes.

## AI Patch And Generative Replace Flow

AI edits are stored separately from normal adjustment masks in
`adjustments.aiPatches`. An `AiPatch` contains:

- `id`, `name`, `visible`, `invert`, `prompt`, and transient `isLoading`
- `subMasks`, using the same submask model as normal masks
- `patchData`, normally containing generated `color` and `mask` image payloads

`invoke_generative_replace_with_mask_def` prepares a source image by removing
the active patch from `currentAdjustments.aiPatches`, compositing any remaining
patches on top of the base image, rasterizing the active patch submasks into a
mask, unwarping geometry for generation, then choosing a backend:

- `useFastInpaint: true`: local LaMa inpainting through `run_lama_inpainting`
- `aiProvider === "cloud"` with a token: `https://getrapidraw.com/api`
- `aiProvider === "ai-connector"` with an address: `http://{address}`
- otherwise: returns a "No generative backend configured" error

The cloud/connector path sends source/mask/prompt data through
`ai_connector::process_inpainting`. It POSTs `/inpaint`; on `404` it uploads a
JPEG source image to `/upload_source` and retries `/inpaint`. Responses are
expected to contain a crop offset and base64 color result, which Rust composites
back into a full-size patch color image.

The final patch payload stores JPEG base64 for `color` and `mask`. Preview,
export, and other render paths call `composite_patches_on_image` to alpha-blend
visible patch colors onto the base image through the stored patch mask.

## Provider, Connector, Cloud, And Auth Touchpoints

`app/settings.rs` persists:

- `aiProvider`
- `aiConnectorAddress`, with `comfyuiAddress` accepted as a serde alias
- AI tagging settings: `enableAiTagging`, `taggingThreadCount`,
  `customAiTags`, and `aiTagCount`

The Rust default for `aiProvider` is `"cpu"`. `AIPanel.tsx` also falls back to
`"cpu"` when settings are not loaded. The settings UI provider switch currently
offers only `"cpu"` and `"ai-connector"`; the `"cloud"` option is commented out
there, but AIPanel and Rust still contain cloud branches and use them if the
setting is present.

The app is wrapped in `ClerkProvider` in `src/App.tsx`. AIPanel and Settings use
Clerk as follows:

- `useAuth().getToken()` supplies a bearer token for cloud generative replace.
- `useUser()` checks `user.publicMetadata.plan === "pro"` before enabling cloud
  generation in the panel.
- Settings contains Clerk `SignIn`, `CloudDashboard`, and `signOut` UI for the
  cloud provider branch.
- AIPanel and `CloudDashboard` fetch cloud usage from
  `https://getrapidraw.com/api/usage` with the Clerk bearer token.

`check_ai_connector_status` reads the saved `aiConnectorAddress`, calls
`http://{address}/health`, and emits `ai-connector-status-update`. `App.tsx`
invokes that command on startup and every 10 seconds. The settings panel also
has a one-shot connection test through `test_ai_connector_connection`.

## Model Download And Status Events

Rust emits these AI/generative-adjacent events:

| Event                           | Producer                    | Consumer/state                                                                             |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `ai-model-download-start`       | `download_and_verify_model` | Frontend event handling sets `useProcessStore.aiModelDownloadStatus` elsewhere in the app. |
| `ai-model-download-finish`      | `download_and_verify_model` | Clears or updates the same download status.                                                |
| `ai-connector-status-update`    | `check_ai_connector_status` | `App.tsx` parses `{ connected }` and sets `useEditorStore.isAIConnectorConnected`.         |
| `denoise-progress`              | BM3D and AI denoise paths   | Denoise UI progress.                                                                       |
| `denoise-complete`              | `denoise_image`             | Carries original/denoised preview data and stores the full denoise result in `AppState`.   |
| `denoise-error`                 | Denoise commands            | Error reporting.                                                                           |
| `denoise-batch-progress`        | `batch_denoise_images`      | Batch progress.                                                                            |
| `indexing-started/progress/...` | `start_background_indexing` | Library AI tagging/indexing progress.                                                      |

AIPanel displays AI model download status during AI mask operations and
specifically checks for `"Inpainting"` when showing the local inpaint model
download message.

## Persistence And Payload Compression Behavior

Large generated data lives in normal adjustment state:

- AI mask data is embedded in submask parameters as base64 PNG data URLs.
- AI patch data is embedded in `aiPatches[*].patchData` as base64 JPEG strings.
- Loaded adjustments normalize missing masks, submasks, and AI patches in
  `normalizeLoadedAdjustments`.

To avoid resending large payloads on every preview, the frontend
`prepareAdjustmentPayloadForBackend` sends each submask mask-data payload or
patch-data payload once, then replaces repeated values with `null` for
subsequent preview calls. Rust rehydrates null values from `AppState.patch_cache`
using patch/submask ids in `adjustment_utils.rs`.

This cache is process-local. It is cleared on image load and cache-clearing
paths. Persisted sidecar data still needs the full adjustment payload; the
null-stripping behavior is for backend preview requests, not a storage format.

## Migration-Relevant Risks And Gaps

- The app has three provider states in code (`cpu`, `ai-connector`, `cloud`),
  but settings only exposes `cpu` and `ai-connector` today. Cloud remains a
  latent code path gated by Clerk auth and `isPro`.
- Local mask generation and local inpainting are tightly coupled to Tauri
  commands, app data model downloads, and `AppState` caches. Moving only
  generative replace would leave local mask generation in desktop Rust unless a
  separate migration decision is made.
- AI masks and generated patches are persisted as large base64 payloads inside
  adjustments. That is simple for local sidecars but creates payload-size,
  cache-hydration, and replay considerations for a server boundary.
- `patch_cache` and `patchesSentToBackend` are id-based transient caches. A
  server path would need explicit rules for when full data is required and when
  ids are only local cache handles.
- The cloud branch sends full source image material, mask image data, prompt,
  source id, and bearer auth to `getrapidraw.com`. Privacy, retention,
  deduplication, and retry semantics are not represented in this client code.
- `generate_source_id` hashes the source path plus file modification time. That
  identifies a local file version but is not content-addressed.
- The AI connector health check only tests whether a GET to `/health` succeeds;
  it does not validate model capability, API shape, auth, or inpaint endpoint
  readiness.
- The CLIP tokenizer download is not hash-verified, while the ONNX model files
  are.
- `AiState` has one cached embedding and one cached depth map. Switching images
  or geometry invalidates the single cache entry; concurrency and multi-image
  workflows are not modeled as a broader cache.
- Some backend AI capabilities are not exposed uniformly in the AI inpainting
  panel. Sky and depth exist in Rust and the general mask taxonomy, but the AI
  panel creation/component lists omit them.
- `useFastInpaint` defaults to local inpainting when generative provider access
  is unavailable. This means "generate" may be local LaMa, cloud, or connector
  depending on UI state and settings.

## Static Snapshot Limitations

This document was created by static code inspection only. It does not verify
runtime model downloads, actual connector/cloud responses, Clerk tenant
configuration, sidecar save/load payloads on disk, or UI behavior in a running
app.
