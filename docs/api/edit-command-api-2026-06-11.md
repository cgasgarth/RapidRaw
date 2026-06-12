# Edit Command API

- Snapshot date: 2026-06-11
- Issue: #82 `docs(api): document edit command API`
- Repository: `cgasgarth/RapidRaw`
- Local checkout: `/Users/cgas/Documents/RawEngine/RapidRaw-doc-edit-api`
- Baseline branch: `codex/docs-edit-command-api`

## Purpose

This document records the intended RawEngine edit command API contract before the
typed command bus and versioned edit graph are implemented. It is a documentation
baseline, not a runtime API implementation.

The current RapidRAW codebase still uses a mix of React state, Tauri `invoke`
calls, broad JSON adjustment payloads, and Rust command handlers. RawEngine's
target is stricter: every meaningful editing surface should become invokable
through a typed, versioned command layer shared by UI, tests, CLI, batch jobs,
plugins, and the future OpenAI app-server agent.

## Current Baseline

Current frontend command names are centralized in `src/components/ui/AppProperties.tsx`
through the `Invokes` enum, but not every frontend/backend call uses that enum.
Some calls still use raw string command names.

Current backend command registration is centralized in
`src-tauri/src/lib.rs` through `tauri::generate_handler![...]`. The handler list
is broad and includes image loading, adjustments, thumbnails, metadata, exports,
tagging, AI, denoise, panorama, HDR, culling, lens correction, negative
conversion, Android integration, logging, and cache management.

Current editing calls generally pass JSON adjustment snapshots rather than
schema-versioned command operations. Rust then reads known JSON keys while
preserving flexibility for unknown frontend-owned values. This is useful for
RapidRAW compatibility but is not sufficient for app-server tools, deterministic
replay, schema generation, or safe multi-actor editing.

## Design Principles

The RawEngine edit command API should follow these principles:

- UI uses the same command layer as automation.
- Commands are schema-validated before execution.
- Commands are versioned and migratable.
- Mutating commands are undoable where practical.
- Commands are deterministic where practical and explicit where nondeterministic.
- Dry-run is first-class for high-risk writes, batch actions, and agent tools.
- Commands return structured results, warnings, artifacts, and validation errors.
- Destructive file operations require explicit approval.
- Batch operations are first-class.
- Headless validation and replay are supported.
- Raw Tauri invokes are not exposed directly to app-server tools.

## Command Envelope

Every mutating edit command should use a shared envelope:

```json
{
  "commandId": "cmd_01HY...",
  "commandType": "tone.exposure.set",
  "schemaVersion": 1,
  "target": {
    "assetId": "asset_01HY...",
    "graphId": "graph_01HY...",
    "scope": "selected-image"
  },
  "expectedGraphRevision": "rev_00042",
  "params": {
    "exposure": 0.35
  },
  "mode": "dry-run",
  "approval": {
    "required": false,
    "approvalId": null
  },
  "actor": {
    "kind": "ui",
    "id": "local-user"
  },
  "timestamp": "2026-06-11T00:00:00Z",
  "correlationId": "corr_01HY...",
  "idempotencyKey": "idem_01HY..."
}
```

Required envelope fields:

- `commandId`: stable ID for this command attempt.
- `commandType`: discriminated command family and operation.
- `schemaVersion`: command payload schema version.
- `target`: asset, graph, layer, mask, batch, or project scope.
- `expectedGraphRevision`: optimistic concurrency guard for graph mutations.
- `params`: command-specific parameters.
- `mode`: `dry-run`, `apply`, `preview`, or `audit`.
- `approval`: approval requirement and approval token when needed.
- `actor`: UI, CLI, batch, plugin, agent, system, or test.
- `timestamp`: client/server timestamp recorded for audit.
- `correlationId`: groups related commands, previews, and logs.
- `idempotencyKey`: prevents duplicate application where practical.

## Command Result Envelope

Command results should be structured and machine-readable:

```json
{
  "commandId": "cmd_01HY...",
  "status": "dry-run-ok",
  "beforeGraphRevision": "rev_00042",
  "afterGraphRevision": null,
  "warnings": [],
  "parameterDiff": [
    {
      "path": "/operations/3/params/exposure",
      "before": 0,
      "after": 0.35
    }
  ],
  "artifacts": [
    {
      "artifactId": "preview_01HY...",
      "kind": "preview",
      "mediaType": "image/jpeg",
      "sha256": "..."
    }
  ],
  "errors": [],
  "auditId": "audit_01HY..."
}
```

Result statuses should include:

- `dry-run-ok`
- `applied`
- `preview-ready`
- `validation-error`
- `revision-conflict`
- `approval-required`
- `cancelled`
- `dependency-missing`
- `render-failed`
- `failed`

Results should avoid returning large base64 image payloads. Prefer artifact IDs,
cache handles, app-controlled paths, or streamed handles.

## Query Envelope

Read-only operations should use a query envelope rather than a mutating command:

```json
{
  "queryId": "qry_01HY...",
  "queryType": "asset.histogram.get",
  "schemaVersion": 1,
  "target": {
    "assetId": "asset_01HY..."
  },
  "params": {
    "space": "display"
  },
  "actor": {
    "kind": "ui",
    "id": "local-user"
  },
  "correlationId": "corr_01HY..."
}
```

Read-only queries may inspect:

- projects and catalogs;
- assets and sidecars;
- edit graph state;
- metadata and EXIF summaries;
- histograms and waveform summaries;
- masks and layer topology;
- preview and render artifact status;
- fixture and validation outputs.

Read-only queries must not mutate sidecars, catalogs, cache files, source files,
or derived artifacts.

## Command Families

Initial command families should map to RawEngine edit graph operations:

| Family       | Example command types                                                      |
| ------------ | -------------------------------------------------------------------------- |
| RAW/profile  | `raw.decode.set`, `profile.camera.set`, `profile.input.set`                |
| Tone         | `tone.exposure.set`, `tone.curve.set`, `tone.filmic.set`                   |
| Color        | `color.whiteBalance.set`, `color.hsl.set`, `color.selectiveRange.set`      |
| Detail       | `detail.sharpen.set`, `detail.denoise.set`                                 |
| Geometry     | `geometry.crop.set`, `geometry.rotate.set`, `geometry.perspective.set`     |
| Effects      | `effect.grain.set`, `effect.halation.set`, `effect.vignette.set`           |
| Masks        | `mask.brush.add`, `mask.aiSubject.generate`, `mask.luminanceRange.set`     |
| Layers       | `layer.adjustment.add`, `layer.opacity.set`, `layer.blendMode.set`         |
| Merge        | `merge.hdr.create`, `merge.panorama.create`, `merge.focusStack.create`     |
| Negative Lab | `negative.baseSample.set`, `negative.inversion.apply`, `negative.qc.audit` |
| AI           | `ai.inpaint.preview`, `ai.inpaint.apply`, `ai.tagging.run`                 |
| Export       | `export.recipe.set`, `export.batch.start`, `export.artifact.regenerate`    |

The table is a namespace baseline. Actual command schemas should be introduced
incrementally through small issue-linked PRs.

## Dry-Run And Approval

Dry-run is required before:

- destructive file actions;
- batch sidecar writes;
- exports that overwrite existing files;
- agent-driven writes;
- low-confidence negative lab calibration;
- provider-backed generative AI edits;
- schema migrations;
- large merge operations such as panorama, HDR, focus stacking, or
  super-resolution.

Dry-run results should include:

- affected assets and paths;
- parameter diff;
- expected graph revision changes;
- warnings and severity;
- preview or validation artifacts when relevant;
- approval requirement;
- rollback or undo availability.

Approval should be explicit and scoped. An approval for one command or batch
scope must not silently authorize broader file access or unrelated mutations.

## Revision And Conflict Policy

Every graph mutation should include `expectedGraphRevision`.

- If the current graph revision differs, the command should return
  `revision-conflict`.
- Commands may offer a safe merge suggestion only when the schema declares the
  operation commutative or independently mergeable.
- UI, API, batch, and agent paths must follow the same conflict rules.
- Conflict responses should include the current revision and enough context for
  the caller to rebase or retry intentionally.

## Provenance And Audit

Every applied command should append provenance:

- actor kind and ID;
- command ID and type;
- before/after graph revision;
- parameter diff;
- warnings;
- artifact IDs and hashes;
- provider/model/prompt details for AI commands;
- approval ID when approval was required;
- source asset hash when practical;
- timestamp and correlation ID.

Audit records should be queryable and suitable for the future app-server agent
activity panel.

## App-Server Boundary

The OpenAI app-server agent should consume generated command/query tool schemas.

Agent tools must not:

- call raw Tauri invokes directly;
- automate UI gestures as the editing API;
- mutate files without dry-run and scoped approval;
- silently expand file scope;
- hide warnings, low-confidence states, or provider fallbacks.

Agent tools should expose:

- read-only inspect tools;
- dry-run tools;
- apply tools with approval metadata;
- cancellation where long-running work is supported;
- preview, diff, warning, and audit outputs;
- rollback or undo handles where available.

## Validation Requirements

Future implementation PRs should add validation in layers:

- schema sample validation for every command and query;
- JSON Schema or equivalent generated artifacts;
- TypeScript and Rust schema parity checks;
- command replay smoke tests;
- dry-run snapshot tests;
- revision conflict tests;
- approval-boundary tests for destructive and agent commands;
- app-server tool schema validation before agent exposure.

This documentation PR does not add those gates. It defines the baseline contract
future work should implement and validate.

## Current Gaps

- The command bus does not exist yet.
- Edit graph revisions do not exist yet.
- Current RapidRAW adjustments are broad JSON snapshots rather than individual
  versioned operations.
- Current frontend and Rust command surfaces are manually mirrored.
- App-server tools are not implemented.
- Generated command/query schemas are not implemented.
- Replay, dry-run, approval, and audit logs are not yet first-class runtime
  features.
