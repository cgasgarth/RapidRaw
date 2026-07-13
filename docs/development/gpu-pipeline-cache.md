# GPU pipeline cache and warmup

RapidRaw owns one `GpuPipelineRegistry` per compute-device generation. Display-profile or window-target changes reuse that registry; a recreated WGPU device receives a new generation and a new registry.

The registry fingerprints the exact core and optional WGSL sources, entry points, layout ABI versions, WGPU version, backend, adapter vendor/device, privacy-hashed adapter and driver details, requested feature words, and limits. Cache directories expose only the SHA-256 identity. Opaque bytes are loaded only when separate metadata has the same identity and the recorded artifact size and SHA-256 match. Invalid artifacts are quarantined and compilation continues without them.

WGPU 29 currently exposes application-managed persistent pipeline caches only for Vulkan. Metal, DX12, GL, and browser backends report `unsupported` and use the same asynchronous in-process shader warmup without writing opaque cache bytes. Vulkan artifacts are capped at 64 MiB, published with a synced temporary file plus atomic rename, and retained for at most three recent device identities.

Native QA can set `RAPIDRAW_GPU_PIPELINE_CACHE_MODE=cold` to remove only the current validated identity before device creation, or `off` to disable application-managed persistence while retaining correct in-process compilation.

Core image and blur shaders warm on a background thread after device creation. Editor demand joins that single-flight warmup instead of compiling concurrently. Flare pipelines remain demand-created and schedule a bounded asynchronous persistence update after they materially expand a supported cache. Cache or warmup failure never prevents correct demand compilation.

The `get_gpu_pipeline_report` command exposes the device generation, privacy-safe identity digest, cache hit/rejection/read/write counters, warmup state and duration, and foreground pipeline wait for native QA and diagnostics.

## Validation

Identity, integrity, corruption fallback, privacy-safe paths, manifest coverage, and retention are normal Rust tests:

```sh
bun scripts/ci/run-resource-coordinated.ts --resource native-heavy \
  --label gpu-pipeline-registry-tests -- cargo test --locked \
  --manifest-path src-tauri/Cargo.toml -p RapidRAW pipeline_registry \
  --features required-ci
```

The native cold/warm proof uses real WGPU output, recreates the processor 30 times after the cold render, requires exact RGBA16 pixel equivalence, and requires the warm median to beat cold latency. It also proves an ordinary render leaves both optional flare pipelines unconstructed, then demand-creates them on the first enabled flare render and verifies changed output:

```sh
bun scripts/ci/run-resource-coordinated.ts --resource native-heavy \
  --label gpu-pipeline-cold-warm -- cargo test --locked \
  --manifest-path src-tauri/Cargo.toml -p RapidRAW \
  cold_and_warm_pipeline_outputs_match_and_warm_creation_is_faster \
  --features required-ci,tauri-test -- --ignored --nocapture
```

On a repeated Apple Metal validation run, WGPU correctly reported persistent-cache support as unavailable. Cold first render was 23.1 ms, the 30-run warm median was 7.8 ms (66% lower), output was pixel-identical, and diagnostics reported 5 ms of core warmup/foreground wait. The same run proved the optional flare pipelines were absent for ordinary output and appeared only after the enabled flare request. An initial uncached driver run was also observed at 654.7 ms versus an 8.4 ms warm median; the repeated receipt is the maintained comparison because platform driver caches are outside application control.
