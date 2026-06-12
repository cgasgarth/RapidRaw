# RawEngine Developer API Guide

- Date: 2026-06-11
- Issue: #255 `docs(api-guide): add developer API guide`
- Scope: developer-facing API expectations for future RawEngine command, query, schema, app-server, and validation work.

## Purpose

RawEngine's API is the product boundary between the UI, Rust/Tauri bridge,
automation, validation harnesses, future CLI, and OpenAI app-server agent. Every
meaningful editing surface should be available through this API instead of
living only behind React gestures or ad hoc Tauri invokes.

This guide turns the API requirements in `RAW_EDITOR_PLAN.md` into an
implementation checklist for future PRs. It is not a claim that the API already
exists in full.

## Non-Negotiable Rules

- Originals are immutable. No command may modify a RAW source file.
- UI, tests, automation, batch jobs, and agent tools call the same command/query
  layer.
- Mutating commands are schema-validated, replayable, undoable where practical,
  and provenance-producing.
- Agent/app-server tools never expose raw Tauri invokes or UI automation as edit
  tools.
- Destructive, external, cloud, expensive, or ambiguous operations require
  dry-run output and scoped approval before apply.
- Large image payloads are returned as artifact handles, preview handles,
  app-controlled paths, task IDs, or streamed progress references instead of
  inline base64 blobs.
- Zod is the TypeScript-facing schema source of truth until a later ADR replaces
  it.
- Rust serde contracts are generated from, or contract-tested against, the same
  schema samples. TypeScript and Rust must not become independent schema
  authorities.

## Target Layers

| Layer                         | Responsibility                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| `packages/rawengine-schema/`  | Zod-authored command, query, graph, artifact, provenance, error, and tool schemas. |
| `src-tauri/src/edit_core/`    | Pure Rust command replay, graph mutation, migration, and deterministic validation. |
| `src-tauri/src/bridge/`       | Tauri adapter, typed error mapping, task lifecycle, cancellation, and handles.     |
| UI command facade             | React/Zustand client for command and query envelopes.                              |
| CLI and validation harnesses  | Headless command replay, batch validation, fixture checks, and golden tests.       |
| OpenAI app-server integration | Generated dynamic tools using the same command and query registry.                 |

Existing RapidRAW adjustment snapshots may remain during migration, but new edit
surfaces should move behind typed command envelopes instead of widening
unstructured payloads.

## Command Envelope

Every mutating command should eventually use a versioned envelope with these
fields or explicit successors:

| Field                   | Requirement                                                            |
| ----------------------- | ---------------------------------------------------------------------- |
| `commandId`             | Stable ID for audit, replay, logs, and correlation.                    |
| `commandType`           | Namespaced command name such as `tone.setExposure`.                    |
| `schemaVersion`         | Version of the command payload contract.                               |
| `target`                | Asset, project, layer, mask, roll, artifact, or export target.         |
| `expectedGraphRevision` | Optimistic concurrency guard.                                          |
| `parameters`            | Strict schema-validated command parameters.                            |
| `dryRun`                | Whether the command previews effects without committing state.         |
| `approval`              | Required approval class and approval token when needed.                |
| `actor`                 | `ui`, `cli`, `batch`, `plugin`, `agent`, `server`, or test harness.    |
| `timestamp`             | Client or server timestamp recorded for audit.                         |
| `correlationId`         | Groups related commands, previews, renders, and app-server tool calls. |
| `idempotencyKey`        | Required where retrying could duplicate output or side effects.        |

Command results should be structured:

- `success`
- `validation_error`
- `revision_conflict`
- `approval_required`
- `render_failed`
- `dependency_missing`
- `cancelled`
- `partial_failure`

Each non-success result should include a typed error code, severity,
retryability, validation path when relevant, and remediation text suitable for UI
and agent responses.

## Query Envelope

Read-only queries inspect state and never mutate graph, sidecar, catalog,
artifact, or file data.

Initial query families:

- Project: open project state, folders, selected image, library filters, and
  catalog health.
- Image: metadata, EXIF/IPTC/XMP read model, rating, color label, tags, and
  virtual-copy relationships.
- Edit graph: graph revision, operation list, layer tree, mask tree, command
  history, undo/redo availability.
- Preview: preview handles, histogram, scopes, clipping summary, sampled pixels,
  before/after comparison handles.
- Artifact: derived asset metadata, export recipes, cache state, stale artifact
  reasons, provenance chain.
- Validation: schema version, known missing dependencies, feature flags, and
  backend capability status.

## Write Command Families

The first public command registry should cover small representative examples
before broad feature work:

- Metadata: set rating, color label, and user tags.
- Edit graph: add, update, remove, reorder, undo, redo, and create virtual copy.
- Tone: exposure, contrast, highlights, shadows, curve, and display transform.
- Color: white balance, HSL, color grading, selective color, and skin-tone
  controls.
- Masks: brush mask, range mask, AI mask result attachment, combine, refine.
- Layers: create layer, set opacity, attach mask, apply layer adjustment.
- Computational: HDR merge, panorama, focus stack, and super-resolution output.
- Export: create recipe, validate export, render export, and collision handling.
- Negative Lab: acquisition setup, inversion, roll normalization, creative
  positive rendering, QC, and positive variant export.

Each family should start with one narrow schema, representative samples, replay
tests, and UI migration before expanding.

## Sidecars And Provenance

RawEngine-native edit state should prefer sidecars. The current RapidRAW
`.rrdata` sidecar remains the migration baseline:

- Primary sidecar: `<image filename>.rrdata`
- Virtual copy sidecar: `<image filename>.<six lowercase hex id>.rrdata`
- Current fields: `version`, `rating`, `adjustments`, optional `tags`, optional
  `exif`

Future command-backed sidecars should add a versioned graph/provenance structure
without breaking existing files. Until a migration ADR lands, new command paths
should dual-write or preserve legacy adjustment data as needed.

Every committed command should record:

- command ID and type
- actor and source surface
- dry-run/apply state
- affected targets
- parameter diff
- warnings
- graph revision before and after
- derived artifact IDs or invalidated artifact IDs
- AI model/provider provenance when AI output affects edits
- approval token or approval class when approval was required

## App-Server Tool Boundary

The OpenAI app-server agent uses generated tools from the same command/query
schema registry. It should not get special edit powers.

Tool rules:

- Read tools may inspect project, image, graph, metadata, previews, scopes,
  artifacts, and validation status.
- Mutating tools call command envelopes with `dryRun: true` before apply unless
  a later ADR proves a safe exception.
- Apply tools require scoped approval for batch edits, file operations, export
  overwrite, external model calls, cloud services, and generative edits.
- Tool schemas use strict objects with explicit required fields and
  `additionalProperties: false`.
- Tool outputs include audit IDs, command IDs, graph revisions, warnings,
  artifact handles, and suggested next actions.
- Agent responses must surface unknown assumptions, missing dependencies,
  clipping warnings, destructive risk, and non-deterministic AI behavior.

Initial app-server tool groups should mirror the command/query registry:

- project inspection
- metadata edits
- preview rendering and comparison
- tone and color edits
- mask and layer operations
- computational photography jobs
- export validation and render
- Negative Lab dry-run, QC, apply, rollback, and export
- AI mask/enhancement tools after provider provenance and approval policies land

## Approval Classes

| Class             | Examples                                                     | Required behavior                                      |
| ----------------- | ------------------------------------------------------------ | ------------------------------------------------------ |
| `safe_read`       | inspect metadata, graph, preview status                      | No approval.                                           |
| `preview_only`    | render preview, dry-run command, compute diff                | No mutation; may be cancellable.                       |
| `edit_apply`      | apply tone/color/mask/layer command                          | Undo and provenance required.                          |
| `batch_apply`     | apply command to many frames or a roll/session               | Dry-run, selected-scope summary, approval, rollback.   |
| `file_mutation`   | move, copy, rename, delete, XMP/IPTC/EXIF write              | Dry-run, explicit approval, no-original-overwrite.     |
| `external_model`  | local or self-hosted AI model with output affecting edits    | Provider provenance and fallback behavior.             |
| `cloud_service`   | cloud AI call, remote processing, account/network dependency | User consent, disclosure, provenance, cancellation.    |
| `generative_edit` | inpaint, replace, or synthesize image content                | Strong approval, provenance, non-determinism labeling. |

## Validation Requirements

Every API-related PR should list exact validation evidence. For schema or command
changes, the expected local and CI surfaces are:

- schema drift check
- strict schema sample validation
- command replay validation
- bridge result/error validation
- sidecar roundtrip validation
- generated app-server tool schema validation
- prompt-injection fixture validation for agent-visible tools
- dry-run/apply replay validation
- approval-boundary validation
- cancellation and rollback validation for long-running or batch commands
- no-original-overwrite validation for file and export operations

Planned command names from the product plan:

- `bun run schema:check`
- `bun run schema:samples`
- `bun run validate:commands`
- `bun run validate:bridge`
- `bun run validate:fixtures`
- `bun run validate:golden`
- `bun run validate:tools`
- `bun run validate:artifacts`

Until those scripts exist, PRs should use the closest available checks and state
the gap explicitly.

## PR Split Guidance

Do not combine an entire API stack in one PR. Split work in this order when
practical:

1. ADR or developer guide.
2. Schema source.
3. Generated artifacts and drift check.
4. Sample payloads and contract tests.
5. Rust serde mirror or generated Rust bindings.
6. Bridge adapter and typed error mapping.
7. Command bus integration.
8. One representative UI route migration.
9. Replay, headless, CLI, or app-server exposure.

Each PR should own one behavior change and one validation story.

## Open Follow-Ups

- Define `CommandEnvelopeV1` and `QueryEnvelopeV1`.
- Add schema package or schema source files.
- Add generated JSON Schema and drift checks.
- Add command sample payloads.
- Add Rust contract tests against schema samples.
- Add typed bridge result and error envelopes.
- Add command replay harness.
- Add app-server tool generation and approval metadata checks.
- Add prompt-injection fixtures for agent-visible tools.
- Add conflict policy for simultaneous UI/API/agent edits.
