# Pre-GPU image identity

The WGPU input texture cache is keyed only by `PreGpuImageIdentity` plus the WGPU device
generation. Final-render hashes remain separate and must not be used as upload identities.

| Stage / adjustment family | Before upload? | Identity dependency |
| --- | --- | --- |
| Source decode / session switch | Yes | `source_revision` and pixel fingerprint |
| Orientation, crop, rotation, flip, lens geometry | Yes | stage revision, dimensions, pixel fingerprint |
| Preview resolution, interactive downscale, export dimensions | Yes | dimensions and pixel fingerprint |
| CPU color mixer families listed by `CPU_COLOR_RENDER_HASH_KEYS` | Yes | transformed pixels and pixel fingerprint |
| Denoise, deblur, wavelet detail | Yes | detail stage revision and pixel fingerprint |
| Clone/heal retouch and patch composition | Yes | finalized pixel fingerprint |
| Exposure, GPU tone, saturation, HSL, curves, color grading, LUT intensity | No | excluded; values are consumed by `RenderRequest` |
| GPU local adjustment values | No | excluded; masks are separate GPU resources |
| Mask geometry / refinement | Separate GPU resource | excluded from input texture identity |
| Output color transform, soft-proof policy, presentation, analytics | After upload | excluded; retained in final-output identities |
| RGBA16F upload ABI | At upload | `precision_abi` |
| GPU context replacement | Cache ownership | `device_generation` |

The finalized image fingerprint is intentional. It is a correctness backstop for newly added
or ambiguous CPU stages: if uploaded bytes change, the identity changes even before a dedicated
stage revision is introduced.

## Counter evidence

The `one_hundred_exposure_changes_reuse_one_input_upload` GPU test records 100 real WGPU renders
of distinct exposure values. Its observed counters are one miss/conversion/texture/view/upload,
followed by 99 hits. For its 16x16 fixture that is 2,048 uploaded bytes total; the former full-job
key would perform 100 uploads (204,800 bytes), so total upload traffic falls 99% and post-warm-up
traffic falls 100%.

The same deterministic RGBA16F byte accounting gives the following upload matrix. Timing and
Instruments data require the macOS app and a project-owned/public RAW and are intentionally not
claimed by the unit benchmark.

| Finalized base | One upload | Former 100-change path | New 100-change path | Reduction |
| --- | ---: | ---: | ---: | ---: |
| 1920x1080 | 15.82 MiB | 1,582.03 MiB | 15.82 MiB | 99% total; 100% warm |
| 3840x2160 | 63.28 MiB | 6,328.12 MiB | 63.28 MiB | 99% total; 100% warm |
| 6000x4000 | 183.11 MiB | 18,310.55 MiB | 183.11 MiB | 99% total; 100% warm |
