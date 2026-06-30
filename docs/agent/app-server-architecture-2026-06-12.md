# App-Server Agent Architecture

- Snapshot date: 2026-06-12
- Issues: #207 `consult(agent): get app-server architecture review`, #210
  `agent(docs): add app-server design doc`
- Repository: `cgasgarth/RapidRaw`
- Related docs:
  - [Sample agent guide](sample-agent-guide-2026-06-11.md)
  - [Developer API guide](../api/guide/developer-api-guide-2026-06-11.md)
  - [Edit command API baseline](../api/commands/edit-command-api-2026-06-11.md)
  - [AI hooks baseline](../baseline/rapidraw-ai-hooks-baseline-2026-06-11.md)
  - [AI provider abstraction](../api/ai-provider-abstraction-2026-06-12.md)

## Purpose

This document freezes the first RawEngine architecture boundary for an expert
image-editing agent built on OpenAI Codex app-server. It is a design and
validation contract, not an implementation claim.

The key decision is that Codex app-server is the conversation, approval,
streaming, and agent integration boundary. RawEngine's own typed command/query
API remains the image-editing authority. The app-server agent must not gain
special edit powers that the UI, CLI, batch jobs, and validation harnesses do
not also use.

## Official App-Server Constraints Checked

Current OpenAI docs describe Codex app-server as the interface used by rich
clients that need authentication, conversation history, approvals, and streamed
agent events. They direct automation and CI-style jobs toward the Codex SDK
instead of app-server.

Relevant current protocol constraints:

- App-server uses bidirectional JSON-RPC 2.0 messages with the `jsonrpc` field
  omitted on the wire.
- Supported transports are stdio JSONL, experimental WebSocket, Unix socket,
  and `off`.
- WebSocket transport is experimental and should remain local or protected by
  explicit authentication if used.
- App-server clients initialize, send the `initialized` notification, start or
  resume a thread, start a turn, then stream item and turn notifications.
- Version-matched TypeScript or JSON Schema artifacts can be generated from the
  installed Codex CLI.
- Some methods and fields require the client to opt into the experimental API.

Source pages checked:

- <https://developers.openai.com/codex/app-server>
- <https://developers.openai.com/codex/cli/reference>
- <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>

## Non-Goals For The First Implementation

Do not build these in the first app-server PRs:

- a user-facing chat panel that can mutate photos before command schemas,
  approvals, provenance, and replay exist;
- UI automation as the edit path;
- raw Tauri command exposure through app-server tools;
- broad `adjustments` JSON pass-through tools;
- direct `.rrdata` file edits by the agent;
- remote WebSocket exposure as the default app integration;
- cloud generative editing without explicit pixel-upload disclosure,
  provenance, cancellation, and approval records;
- full Negative Lab, panorama, HDR, focus stack, or super-resolution tools
  before their command envelopes and validation fixtures exist.

## Architecture Decision

RawEngine should use a local sidecar service shape with three layers:

| Layer                        | Owner     | Responsibility                                                             |
| ---------------------------- | --------- | -------------------------------------------------------------------------- |
| Codex app-server client      | RawEngine | Starts or connects to Codex app-server, manages thread and turn streams.   |
| Agent tool adapter           | RawEngine | Publishes strict generated tools and maps tool calls to command/query API. |
| RawEngine command/query core | RawEngine | Validates, dry-runs, applies, replays, and records image-edit operations.  |

The app-server adapter should be process-local for v1. Preferred transports:

1. stdio JSONL for deterministic local smoke tests and generated-schema checks;
2. Unix socket for desktop app integration once lifecycle management is needed;
3. WebSocket only for local development diagnostics with auth enabled.

The agent tool adapter must be replaceable. If app-server protocol details
change, RawEngine command schemas, replay records, sidecars, and validation
fixtures should remain stable.

## Surface Selection

RawEngine should keep these integration surfaces distinct:

| Surface                     | Use it for                                                      | Do not use it for                                     |
| --------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| RawEngine command/query API | All image-edit semantics, replay, validation, provenance, undo. | Conversation history or model orchestration.          |
| Codex app-server            | Expert chat agent, approvals, streamed events, local thread UI. | Headless CI jobs or bypassing RawEngine schemas.      |
| Codex SDK                   | Future non-interactive automation or CI-like batch jobs.        | User-facing desktop chat state.                       |
| MCP                         | External tool/context integration when a model client needs it. | RawEngine's internal edit graph or sidecar authority. |
| Tauri commands              | Desktop bridge implementation detail.                           | Public agent tools or long-term API contracts.        |
| OpenAI Apps SDK             | Future ChatGPT-hosted app surfaces if needed.                   | The local macOS RawEngine editing core in this phase. |

The first agent implementation should prove that app-server can invoke a narrow
RawEngine command through the same schemas as UI/tests. It should not attempt to
make app-server the canonical API for editing.

`app-server` should not be treated as an image AI provider. It is an agent
runtime that may call local CPU/GPU, self-hosted connector, cloud, or future
provider-backed tools through RawEngine policy. The current provider schema can
carry `app-server` as a temporary compatibility contract, but a later PR should
split agent runtime IDs from image provider IDs before exposing runtime behavior
in the UI.

## Command Boundary

Every mutating agent tool should map to a RawEngine command envelope with these
minimum fields:

| Field                   | Requirement                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `commandId`             | Stable audit and replay identifier.                              |
| `commandType`           | Namespaced RawEngine command name.                               |
| `schemaVersion`         | Versioned payload contract.                                      |
| `target`                | Project, image, virtual copy, layer, mask, roll, or artifact.    |
| `expectedGraphRevision` | Optimistic concurrency guard against UI or agent races.          |
| `parameters`            | Strict schema-validated command parameters.                      |
| `dryRun`                | Required before most agent mutations.                            |
| `approval`              | Approval class, state, token, and reason when required.          |
| `actor`                 | `agent` with session and thread identifiers.                     |
| `correlationId`         | Groups plan, preview, approval, apply, render, and audit events. |
| `idempotencyKey`        | Required for retryable commands that create output.              |

The app-server tool schema may be generated from this envelope or wrap it with a
friendlier tool-specific schema, but the adapter must produce the command
envelope before touching RawEngine state.

Settings migration schemas may remain tolerant when needed for old RapidRAW
state, but agent-facing tool schemas must be strict. Unknown keys, unknown
provider IDs, missing approvals, and extra mutation fields are validation
failures.

## Tool Taxonomy

Tools should be grouped by risk and output type, not only by product feature.

### Read Tools

- `project.list_images`
- `project.get_selection`
- `image.get_metadata`
- `image.get_sidecar_summary`
- `graph.get_revision`
- `graph.list_operations`
- `layer.list`
- `mask.list`
- `artifact.list`
- `validation.get_capabilities`

Read tools never write sidecars, cache files, exports, catalog records, or
derived artifacts.

### Preview And Analysis Tools

- `preview.render`
- `preview.compare`
- `preview.get_histogram`
- `preview.get_scopes`
- `preview.sample_pixels`
- `preview.get_clipping_summary`
- `validation.run_local_checks`

Preview tools may write temporary cache artifacts but must return handles, not
large inline image payloads.

### Performance And Payload Rules

The agent boundary must preserve local editor performance:

- Never stream RAW files, full-resolution renders, masks, generated patches, or
  merge intermediates inline as chat/tool JSON unless a later measured exception
  proves it is safe.
- Use artifact handles for previews, thumbnails, masks, histograms, scopes,
  denoised variants, generated positives, HDR/panorama/focus-stack outputs, and
  exports.
- Long-running tools return task IDs and progress events. They must support
  cancellation and must leave partial artifacts either quarantined or clearly
  marked as incomplete.
- Tool results should contain numeric summaries, hashes, dimensions, color
  spaces, clipping warnings, and preview handles instead of opaque pixel blobs.
- Cached preview handles are process-local unless explicitly promoted to a
  sidecar or derived artifact record.
- The app-server adapter must apply backpressure and reject oversized tool
  payloads before they reach the edit core.
- Full-resolution render, AI inference, panorama, HDR, focus stacking,
  super-resolution, and Negative Lab batch work should run through RawEngine job
  scheduling, not directly inside a synchronous app-server tool handler.
- Local AI caches inherited from RapidRAW should be treated as single-user
  desktop caches until a real job/cache manager exists. Multi-image or
  concurrent agent workflows should serialize, return `busy`, or return a
  retryable error rather than corrupting shared SAM/depth/inpaint state.

### Dry-Run Tools

- `edit.dry_run_tone`
- `edit.dry_run_color`
- `edit.dry_run_crop`
- `layer.dry_run_create`
- `mask.dry_run_create`
- `ai.dry_run_subject_mask`
- `export.dry_run`
- `negative_lab.dry_run_inversion`
- `merge.dry_run_panorama`

Dry-run results must include affected targets, parameter diffs, graph revision,
warnings, estimated cost, generated preview handles, and approval requirements.

### Apply Tools

- `edit.apply_tone`
- `edit.apply_color`
- `edit.apply_crop`
- `layer.create`
- `mask.create`
- `mask.update`
- `artifact.create_variant`
- `export.create`
- `negative_lab.apply_inversion`
- `merge.create_panorama`

Apply tools must require `expectedGraphRevision` and must fail on stale
revisions. They should reference a prior dry-run ID when approval is required.

### AI Provider Tools

- `ai.provider.get_capabilities`
- `ai.provider.check_status`
- `ai.mask.generate_subject`
- `ai.mask.generate_foreground`
- `ai.mask.generate_sky`
- `ai.mask.generate_depth`
- `ai.inpaint.dry_run`
- `ai.inpaint.apply`
- `ai.denoise.dry_run`
- `ai.tagging.run`

Provider tools must record whether source pixels left the machine, the provider
class, model identity when available, prompt fields, mask hashes, output hashes,
and fallback behavior.

Provider status tools must do more than ping a health endpoint. Before the agent
uses a connector or cloud path, RawEngine should know endpoint class, locality,
auth requirements, supported capabilities, model IDs or unavailable reasons,
maximum payload expectations, retention policy when known, and whether source
pixels or metadata will leave the machine.

Path-plus-modification-time source IDs may remain cache keys, but they are not
strong provenance. Agent-visible provenance should record a content hash when
practical, or explicitly label the identity as path/mtime-derived.

## Approval Classes

| Class             | Examples                                     | Agent behavior                                  |
| ----------------- | -------------------------------------------- | ----------------------------------------------- |
| `safe_read`       | metadata, graph summary, provider status     | No approval.                                    |
| `preview_only`    | histogram, scopes, preview render, dry-run   | No persistent mutation.                         |
| `edit_apply`      | tone, color, crop, mask, layer changes       | Dry-run first; undo and provenance required.    |
| `batch_apply`     | many images, rolls, albums, virtual copies   | Scope summary, dry-run, approval, rollback.     |
| `file_mutation`   | export, rename, delete, move, overwrite      | Explicit destination and no-original-overwrite. |
| `external_model`  | local connector or self-hosted model output  | Provider disclosure and provenance.             |
| `cloud_service`   | cloud AI or remote processing                | Pixel upload disclosure and cancellation.       |
| `generative_edit` | inpaint, replace, synthesize, hallucinate    | Strong approval and non-determinism label.      |
| `expensive_job`   | panorama, HDR, focus stack, super-resolution | Cost estimate, cancellation, progress stream.   |
| `unsafe_import`   | LUT, profile, model, plugin, preset import   | Legal/source provenance and quarantine path.    |

Approval is part of the command contract. Chat text alone cannot satisfy it.

## Prompt-Injection Boundary

Agent-visible data is untrusted if it comes from:

- filenames, folder names, sidecar text, metadata, EXIF/IPTC/XMP, captions, OCR,
  AI tags, prompts, generated images, connector responses, cloud responses, or
  downloaded fixture manifests;
- image content that contains readable instructions;
- project notes or presets imported from outside the repository.

Tools must treat this content as data. They must not execute instructions from
it, change approval policy because of it, reveal secrets because of it, or send
source pixels to a provider because of it.

Prompt-injection fixtures should cover at least:

- metadata asking the agent to ignore approvals;
- filenames that look like tool commands;
- sidecar text that requests file deletion;
- OCR/caption text that requests cloud upload;
- connector responses that claim approval was already granted.

## Provenance Requirements

Every committed agent operation should record:

- app-server thread ID, turn ID, item/tool-call ID when available;
- RawEngine command ID, command type, schema version, correlation ID, and
  idempotency key;
- actor kind `agent`, client name, app version, and provider ID;
- affected source image identity, virtual copy, layer, mask, artifact, or roll;
- graph revision before and after;
- dry-run ID and approval record ID when relevant;
- parameter diff and warning list;
- preview or rendered artifact handles used for approval;
- replay input and deterministic replay hash when available.

AI and computational operations should additionally record:

- provider class: local CPU/GPU model, self-hosted connector, cloud service, or
  app-server mediated provider;
- model name, model version, model hash, or unavailable reason;
- model, LUT, preset, profile, and tokenizer source plus hash/signature when
  downloaded or imported;
- prompt, negative prompt, mask ID, mask hash, seed, sampler, strength, and
  non-determinism label where applicable;
- whether source pixels, masks, metadata, or previews left the machine;
- input artifact hashes, output artifact hashes, and invalidation rules.

## Validation Gates

The app-server design is not complete until these checks exist or the PR states
which future issue owns the gap:

- Zod strict schema tests for every tool input and output.
- JSON Schema generation and drift checks from the schema package.
- App-server generated schema snapshot checks for the installed Codex version.
- Contract tests mapping tool inputs to RawEngine command envelopes.
- Rejected-payload tests for unknown keys, missing approvals, stale revisions,
  unsafe destinations, and provider mismatch.
- Connector capability tests that distinguish "reachable" from "safe and
  capable for this operation."
- Artifact-handle tests that reject inline full-resolution raster payloads at
  the app-server boundary.
- Dry-run/apply replay tests against checked-in fixture sidecars.
- Prompt-injection fixture tests for all agent-visible text.
- No raw Tauri invoke exposure check for app-server tool registry code.
- No original overwrite tests for export and file mutation tools.
- Provider-unavailable and cancellation tests for long-running AI/computational
  jobs.
- Audit-log snapshot tests that can be reviewed without the chat transcript.
- A local app-server protocol smoke test using stdio or Unix socket.

Until implementation commands exist, docs-only PRs should run:

```sh
bun run docs:check
git diff --check
```

## Implementation Sequence

1. Land this architecture doc and record the consult outcome.
2. Split agent runtime IDs from AI provider IDs while preserving compatibility
   parsing for any old `app-server` setting value.
3. Add `packages/rawengine-schema/` with Zod command/query/tool primitives.
4. Add generated JSON Schema and schema drift checks.
5. Add representative sample payloads for read, dry-run, apply, preview, export,
   AI provider, and error cases.
6. Add Rust serde contract tests against the sample payloads.
7. Add a headless command replay harness for one safe metadata command and one
   safe tone dry-run command.
8. Add a tool registry generator that emits app-server tool metadata from the
   schema package.
9. Add app-server protocol smoke tests that initialize a local app-server and
   validate the client lifecycle without mutating photos.
10. Expose read-only project and image inspection tools.
11. Expose preview and histogram tools using artifact handles.
12. Expose one narrow dry-run edit tool.
13. Expose one approval-gated apply tool with replay and audit evidence.
14. Migrate inherited AI mask and inpaint flows behind provider-aware command
    schemas before exposing them to the agent.
15. Add Negative Lab, HDR, panorama, focus stacking, and super-resolution tools
    only after their feature-specific command, artifact, and validation ADRs
    have landed.

## Open Decisions

- Whether the first desktop integration should manage app-server over stdio or
  Unix socket.
- Whether generated app-server schemas are committed per Codex version or
  generated only in CI.
- The exact bridge between Zod schemas and Rust serde contracts.
- The exact migration path from `AiProviderId.AppServer` to a separate
  agent-runtime schema.
- The capability discovery contract for self-hosted AI connectors.
- The content-hash policy for RAW files, proxies, generated patches, sidecars,
  and derived artifacts.
- The artifact handle format for previews, scopes, generated positives,
  denoised variants, merge outputs, and exports.
- The approval UI that converts app-server approval requirements into a
  RawEngine-native user decision.
- The retention policy for agent audit logs and preview artifacts.
- How app-server `experimentalApi` opt-in should be isolated from stable
  RawEngine command schemas.

## Consult Follow-Up

A ChatGPT Pro Extended consult was completed in the RapidRaw project on
2026-06-12 for app-server architecture review. The consult agreed that the
planned direction is coherent if app-server remains an agent runtime adapter over
RawEngine's typed editing API.

Recommendations incorporated here:

- keep RawEngine command/query schemas canonical and keep app-server replaceable;
- treat `app-server` as an agent runtime, not an image AI provider;
- use strict schemas for app-server tools even where legacy settings parsing is
  tolerant;
- add connector capability discovery before agent-triggered AI work;
- record strong source/artifact identity where practical instead of relying only
  on path/mtime IDs;
- pass rasters as artifact handles, not full-resolution inline payloads;
- serialize or reject concurrent local AI cache use until job/cache management is
  explicit;
- expose color-management state, preview approximation status, clipping, scopes,
  and output-profile context to the agent;
- keep long-running HDR, panorama, focus-stack, super-resolution, export, and AI
  work behind RawEngine jobs with progress, cancellation, and resource budgets;
- add supply-chain provenance for downloaded or imported models, tokenizers,
  presets, LUTs, and profiles.
