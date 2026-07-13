# Immutable pixel buffer revisions

GPU input reuse is keyed by a construction-time `PixelBufferRevision`, never by rescanning image bytes on the normal render path. The revision contains source, pre-GPU stage, construction/content generation, precision ABI, and revision ABI fields. Dimensions remain explicit in `PreGpuImageIdentity`.

Production callers must use `PreGpuImageIdentity::for_stage` or `from_revision` with the typed fingerprints that constructed the immutable pixels. The convenience `for_test_source` helper is test-only. In the editor path:

- source/decode changes replace `source_revision`;
- geometry, target size, resampling, detail algorithms, and retouch changes replace stage/content generations;
- exposure, contrast, analytics, presentation, masks consumed only by GPU uniforms, and other GPU-only requests preserve the pre-GPU revision; masks that feed CPU retouch composition participate in its content generation;
- cached immutable pixels preserve their revision.

`CachedPreview` stores both its full and interactive-small bases as `RevisionedImage`. The wrapper keeps the `Arc<DynamicImage>` private and exposes shared access only; code that publishes changed pixels must construct a new wrapper and revision. Cache hits reuse the wrapper revision, newly transformed/downscaled buffers receive revisions once at construction, no-op `Cow::Borrowed` stages preserve it exactly, and owned detail/retouch results derive a new revision without re-reading pixels.

`CompiledRenderPlan::fingerprints.pre_gpu_base` is the maintained registry entry for geometry and CPU-only color work before detail/retouch. It intentionally excludes exposure and other GPU uniforms. The retouch fingerprint includes only legacy patches and mask layers with clone/heal/remove sources, so an ordinary local-adjustment mask remains GPU-only while a mask that actually composites CPU pixels invalidates the upload identity.

## Contract verification

`RAPIDRAW_PIXEL_REVISION_VERIFY` controls an optional verifier:

- `off` or unset: production default; reads zero pixel bytes;
- `sampled`: hashes at most 4,096 deterministic samples;
- `full`: records a full reference digest;
- `dual-run`: records the full digest and fails if one revision is reused for different pixels.

Verifier calls, bytes, time, and disagreement counts are included in the existing GPU input-cache diagnostics. Legacy full-hash call/byte counters remain zero because no production adapter exists. Verification digests never become cache identity or persisted artifact identity.

## Proof

The maintained Rust tests cover source/stage/content/dimension/precision invalidation, injected dual-run disagreement, constant-work construction at 100 MP dimensions, and 1,000 GPU-only exposure frames with one conversion/upload and 999 input-cache hits. The native test compares repeated equal-exposure output after 900 cache hits byte-for-byte and requires warm median submit latency to beat the cold frame. The explicit large-buffer benchmark compares one full reference hash with 1,000 O(1) revisions at 1080p, 4K, 8K, 45 MP, and 100 MP:

```sh
bun scripts/ci/run-resource-coordinated.ts --resource native-heavy \
  --label pixel-revision-benchmark -- cargo test --locked \
  --manifest-path src-tauri/Cargo.toml -p RapidRAW \
  construction_revision_latency_is_constant_across_preview_sizes \
  --features required-ci -- --ignored --nocapture
```
