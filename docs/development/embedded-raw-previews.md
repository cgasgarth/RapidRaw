# Embedded RAW preview policy

Embedded previews are a latency bridge, never RapidRaw-developed pixels. The editor keeps the image-open session in `loading`, labels the camera preview, and stores it separately from the authoritative preview URL. Export, masks, proofing, compare truth, histogram/waveform, and pixel sampling remain unavailable until a `settledDeveloped` frame replaces it.

## Pinned RAWler capability matrix

The pinned RAWler `0.7.1` decoder exposes an embedded `full_image` for these families. Extraction parses the container and decodes only that image; it never calls `raw_image` or demosaics the sensor mosaic.

| Family | Container source | Orientation source | Initial policy |
| --- | --- | --- | --- |
| ARW | TIFF JPEG interchange payload | generalized EXIF | accept after bounds checks |
| CR2 | TIFF preview payload | generalized EXIF | accept after bounds checks |
| CR3 | JPEG preview track; HDR-PQ/HEIF may be unavailable | generalized EXIF | reject unsupported preview tracks |
| DNG | preview/full-image IFD | generalized EXIF | accept after bounds checks |
| NEF | high-resolution JPEG interchange payload | generalized EXIF | accept after bounds checks |
| RAF | RAF embedded JPEG region | generalized EXIF | accept after bounds checks |
| RW2, PEF, TFR | decoder-specific embedded full image | generalized EXIF | accept after bounds checks |

All other families fall through to the existing current thumbnail/smart-preview/loading behavior. A candidate is rejected when missing or corrupt, shorter than 640 px on its long edge, larger than 6000 px, above 128 MiB decoded RGBA, or above 16 MiB encoded JPEG. The initial color contract is `encoded_srgb_vendor_preview`: camera picture-style rendering may differ visibly from settled RapidRaw development, and no RAW/output parity is implied.

Each open constructs one session-owned `Arc<RawSource>` backed by RAWler's populated mmap. Provisional extraction and settled development run concurrently against that same mapped source; the full RAW is neither copied nor mapped twice. Generation checks bracket container parse, metadata access, and embedded-image decode. A 250 ms publication deadline bounds the latency bridge, and settled publication permanently suppresses a late provisional completion.

Decoded transport entries are cached by physical `SourceRevision` plus extraction-policy version under a 64 MiB retained-data-URL budget. Virtual copies therefore share the source preview, while a file identity/size/timestamp change produces a different key. If embedded extraction is missing, corrupt, cancelled, or over budget, the existing current thumbnail/smart-preview artifact receives a typed `fastDeveloped` provisional receipt and remains non-authoritative.

## Acceptance proof

Maintained Rust tests cover selector limits, invalid containers, cooperative cancellation, source-revision cache invalidation, virtual-copy reuse, stale A→B suppression, and both injected completion orders. TypeScript tests parse every frame tier and prove that display may consume a provisional URL while export, mask generation, proofing, analytics, sampling, and compare reject its receipt. The browser Tauri harness asserts that the provisional badge appears and is removed on settled replacement.

The ignored private/public runtime matrix is enabled with `RAPIDRAW_PRIVATE_RAW_MATRIX` (semicolon-separated paths). It excludes one warmup per source, then measures five alternating-order baseline/progressive pairs per source against the same mmap. It includes source-open time, validates decoded output dimensions, and enforces first-visible p95 ≤250 ms and settled-decode p95 overhead ≤5%. The 25-pair validation matrix covered 24, 42, 60, and 100 MP Bayer/X-Trans sources. Aggregate first-visible p50/p95 was 21/154 ms and settled-overhead ratio p50/p95 was 0.999/1.016. First-visible p95 by class was 22 ms (24 MP), 25 ms (42 MP), 21 ms (60 MP), and 154 ms (100 MP). The 60/100 MP fixtures were CC0 camera originals from [raw.pixls.us](https://raw.pixls.us/); no RAW or generated output is committed.
