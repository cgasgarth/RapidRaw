# Native cache inventory

Audit updated from `main` at `3282e0c6253a8597e36a5f90f798d1685c964fe4` for #5246.

| AppState field | Key / invalidation inputs | Value / clone behavior | Weight and policy | Pin / consumers | Residency |
|---|---|---|---|---|---|
| `decoded_image_cache` | `DecodedImageKey` (`SourceRevision` plus RAW development identity) | `Arc<DynamicImage>`, `Arc<EXIF>`, `Arc<RawDevelopmentReport>`; request-specific report/EXIF mutation clones metadata only | concrete pixel bytes + string capacities + report; 600 MiB soft/800 MiB hard, max 5 | active loads hold `Arc`; editor/export | CPU |
| `original_image` | current source/session | `LoadedImage` with shared pixels | reported separately as session-owned | current-session priority; editor/export | CPU |
| `cached_preview` | transform hash, scale, crop, preview dimension | two shared images | reported separately as session-owned | current-session priority; preview/viewer | CPU |
| `geometry_cache` | existing visual/negative-preview hash; adjustment and source inputs preserved | `Arc<DynamicImage>` | pixel bytes; 256/384 MiB, max 16; weighted LRU | no global pin; preview/negative lab | CPU |
| `thumbnail_geometry_cache` | source path; stored geometry hash and resolution sufficiency gate | hash + shared image + scale | pixel bytes; 192/256 MiB, max 96; weighted LRU | low priority; thumbnails | CPU |
| `full_transformed_cache`, `full_warped_cache` | transform hash/current session | single shared image slots | separately tracked session state; released on session/GPU-dependent clear | current session; masks/preview | CPU |
| `mask_cache` | mask definition, dimensions, scale/crop, warped adjustment hash | `Arc<GrayImage>` | raw grayscale bytes; 96/128 MiB, max 64; weighted LRU | no pin; render | CPU |
| `patch_cache` | patch identity string | JSON patch payload | not image-resident; explicit session clear; future typed patch issue owns migration | no pin; patch compositor | CPU |
| `lut_cache` | LUT path; parser currently rereads on process restart | `Arc<Lut>` | `Vec<f32>::capacity`; 64/96 MiB, max 32; weighted LRU | no pin; preview/export/thumbnail | CPU; GPU LUT is separate |
| `viewer_sample_frames` | target/revision conventions (`edited`, `original`, `softProof`, SR graph revision) | shared image plus strings | pixel bytes; 96/128 MiB, max 8; weighted LRU | request holds `Arc`; sampler/SR | CPU |
| typed render/resample plans and scratch pools | module-specific typed keys | currently ephemeral or module-owned | no shared `AppState` cache found at this baseline; oversized scratch is not retained here | render/export | CPU |
| `gpu_image_cache` | transform hash and dimensions | WGPU texture/view | accounting hook boundary only; GPU issue owns lifetime | current preview | GPU |

## Ownership and invalidation

The cache that creates an allocation charges its full retained capacity. Secondary `Arc` references charge no pixel bytes. Eviction removes cache ownership only; in-flight work remains valid. Explicit session teardown clears masks and geometry and releases current image slots. Existing key semantics were retained where a typed source/session key is not yet available, avoiding an invalidation change without proof.

`NativeCacheReport` provides one snapshot of coordinator totals and per-cache entries, bytes, limits, hits/misses, admissions, replacements, rejects, evictions, and clears. Current-session slots and GPU allocations are named separately because they do not share cache ownership.
