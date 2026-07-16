# Native runtime service ownership

Status: maintained architecture contract for [#5530](https://github.com/cgasgarth/RapidRaw/issues/5530). The code remains authoritative; update this map in the same PR whenever `AppServices` gains, loses, or transfers a capability.

`AppState` owns only `Arc<AppServices>`. Commands narrow immediately through `AppState::{editor,computational,gpu,library,render,export,film}` or an explicitly scoped service handle. A service mutex protects only an atomic state transition or snapshot. No mutex guard may cross filesystem/decode work, GPU submission, event emission, thread join, blocking wait, or `.await`.

| `AppServices` capability | Sole owner / private mutable fields | Lifecycle and identity | Synchronization / cancellation | Cross-service rule |
| --- | --- | --- | --- | --- |
| `editor` | `EditorRuntimeService`: active image, image-open coordinator and viewer-sample session/cache | selection generation, image session, prefetch collection generation and render-artifact identity | service-owned image/open/sample locks and detached cancellation tokens; stale-session publication rejected | metadata/decode/event/await work occurs between currentness checks; pass immutable image/frame snapshots to render |
| `display_profile` | `DisplayProfileRuntimeService` | display generation and profile fingerprint | atomic snapshot replacement | render receives a profile snapshot |
| `startup` | `StartupRuntimeService` | one process startup generation | service-owned initialization state | work is scheduled after transition |
| `startup_files` | `StartupFileHandoffService` | launch/open request identity | bounded queue/lease | editor consumes owned requests |
| `computational` | `ComputationalRuntimeService`: denoise, HDR, focus, burst-SR, panorama and `JobCoordinator` | typed per-family generation plus computational job UUID | family services own cancellation/currentness; job registry linearizes terminal publication | commands call the facade; algorithms receive handles/tokens, never locks |
| `payload_residency` | `PayloadResidencyService` | payload fingerprint and residency generation | service-owned cache budget | render receives retained payload handles |
| `gpu` | `GpuRuntimeServices` | device/context generation | GPU services own context/processor/pipeline locks | CPU services pass plans/snapshots before GPU work |
| `lens_database` | `LensDatabaseService` | database generation | atomic reload/snapshot | editor receives immutable lookup results |
| `export` | `ExportRuntimeServices` | export job handle/generation | registry-owned cancellation and terminal claim | encode/write occurs outside registry locks |
| `film` | `FilmRuntimeServices` | film render request and profile identity | scheduler-owned cancellation/currentness | render consumes immutable governed profiles |
| `render` | `RenderRuntimeServices` | source, graph, geometry, display and preview generations | scheduler/cache services own their own locks | editor/display/GPU data enters as snapshots |
| `library` | `LibraryRuntimeServices` | catalog revision and typed import/index/thumbnail operations | per-service operation registries and cancellation tokens | disk/catalog work occurs after claims are released |
| `ai` (feature gated) | `AiRuntimeService` | model-load session and cache identity | registry-owned cancellation/currentness | model I/O/inference runs outside registry locks |
| `source_fingerprints` | `FingerprintCache` | `SourceRevision` | in-flight digest coalescing | export/load stream bytes without an application lock |

## Migrated cancellation command family

`computational/commands/cancellation.rs` owns the complete IPC family for HDR, focus stack, burst super-resolution, panorama, and explicit computational merge-job cancellation. `ComputationalRuntimeService` translates these calls into service operations. `JobCoordinator` privately wraps the existing `ComputationalMergeJobRegistry`; it does not introduce a competing scheduler or identity.

The focused tests require exact Tauri payload names, cross-family isolation, stale/current operation behavior, cancellation during external I/O/await, and progress publication after the registry lock has been released. Domain registration is declared in `computational/command_registration.rs` and remains covered by the frontend/native invoke parity gate.
