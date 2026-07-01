# Agent Tool-Call Audit Log

- Snapshot date: 2026-06-13
- Issue: #225 `agent(audit): add tool-call audit log`
- Scope: local-first audit log format for RawEngine app-server tool calls.
- Related docs:
  - [App-server agent architecture](app-server-architecture-2026-06-12.md)
  - [Sample agent guide](sample-agent-guide-2026-06-11.md)
  - [Edit command API baseline](../api/commands/edit-command-api-2026-06-11.md)

## Purpose

RawEngine agent tools must leave an audit trail that proves what the agent saw,
what it asked RawEngine to do, what RawEngine validated, what the user approved,
and what changed. The log is not a chat transcript. It is a compact,
machine-checkable record of tool boundaries, command envelopes, graph revisions,
approval decisions, artifact handles, warnings, and replay hashes.

The first audit log is local-only and per-user. It should be stored next to the
project catalog, session archive, sidecar audit directory, or validation fixture
output depending on the runtime surface. It must never require remote service
storage to prove local edit behavior.

## Sample Artifact

The checked sample format lives at:

```text
docs/agent/tool-call-audit-log.sample.json
```

Runtime PRs should eventually replace this hand-authored sample with generated
fixtures from live app-server demo sessions.

## Record Shape

Each audit file contains one session object:

| Field                       | Requirement                                                   |
| --------------------------- | ------------------------------------------------------------- |
| `schemaVersion`             | Audit schema version. Starts at `1`.                          |
| `auditLogId`                | Stable identifier for the audit log file.                     |
| `sessionId`                 | RawEngine editing session id.                                 |
| `appServer`                 | Transport, thread id, turn id, and protocol metadata.         |
| `actor`                     | Agent identity used in command envelopes.                     |
| `target`                    | Project, image, virtual copy, layer, mask, or artifact scope. |
| `startedAt` / `completedAt` | ISO timestamps for the audited sequence.                      |
| `entries`                   | Ordered tool-call records.                                    |
| `timeline`                  | Optional compact linked edit-cycle timeline.                  |
| `replay`                    | Optional replay fixture id, path, and content hash.           |
| `redactions`                | Declares which fields were removed before sharing.            |

Each entry records one boundary crossing:

| Field                                  | Requirement                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `entryId`                              | Stable ordered event id.                                                         |
| `occurredAt`                           | ISO timestamp.                                                                   |
| `phase`                                | `read`, `preview`, `dry_run`, `approval`, `apply`, `replay`, or `error`.         |
| `toolName`                             | Registered RawEngine tool name when a tool is involved.                          |
| `toolKind`                             | Registered tool kind: `read`, `preview`, `dry_run`, `apply`, `export`, or `job`. |
| `approvalClass`                        | Approval class required by the registered tool.                                  |
| `approvalState`                        | `not_required`, `pending`, `approved`, or `denied`.                              |
| `mutates`                              | Whether the entry can persist edit state, sidecars, files, or artifacts.         |
| `inputSchemaName` / `outputSchemaName` | Registered schema names.                                                         |
| `inputHash` / `outputHash`             | Stable hashes of redacted input and output payloads.                             |
| `commandId`                            | RawEngine command id when present.                                               |
| `correlationId`                        | Groups read, dry-run, approval, apply, preview, and replay entries.              |
| `sourceGraphRevision`                  | Revision before the operation when applicable.                                   |
| `resultingGraphRevision`               | Revision after a mutation when applicable.                                       |
| `artifactHandles`                      | Preview, mask, generated, merge, export, or replay artifacts.                    |
| `warnings`                             | Structured warning codes and severity.                                           |
| `durationMs`                           | Wall time for the operation.                                                     |
| `status`                               | `started`, `succeeded`, `failed`, `cancelled`, or `skipped`.                     |

## Iterative Edit Timeline

When an agent performs an iterative edit cycle, the audit log should also include
a compact `timeline` artifact. The timeline is not a replacement for full
entries. It is the small ordered model used by UI history, validation, and replay
checks to prove the edit loop that the user saw.

For the tone adjustment flow, the required event order is:

```text
preview -> dry_run -> apply -> preview_after
```

Each timeline event should link the identifiers already returned by the tools:

| Field                           | Requirement                                               |
| ------------------------------- | --------------------------------------------------------- |
| `eventId`                       | Stable event id unique within the timeline.               |
| `phase`                         | `preview`, `dry_run`, `apply`, or `preview_after`.        |
| `previousEventId`/`nextEventId` | Linked-list pointers proving cycle order.                 |
| `requestId` / `toolName`        | App-server request and tool identity.                     |
| `graphRevisionBefore/After`     | Revision boundary when known.                             |
| `linked.commandId`              | Command id when the tool returns one.                     |
| `linked.dryRunPlanId/Hash`      | Dry-run identity, repeated on apply as the accepted plan. |
| `linked.previewArtifactId`      | Preview or preview-after artifact id when returned.       |
| `linked.auditEventIds`          | Lower-level runtime audit event ids returned by the tool. |
| `linked.replayStepId`           | Stable replay step id for this timeline event.            |
| `warnings`                      | Warning strings/codes returned by the tool.               |
| `status`                        | `succeeded`, `failed`, `cancelled`, or `skipped`.         |

The timeline has a deterministic replay hash over stable identifiers and result
metadata. Runtime validation must reject out-of-order phases, broken
previous/next links, and apply events that do not reference the dry-run plan.
Cancellation and replay IDs should be carried when the underlying app-server
tool or session surface provides them.

## Invariants

Audit validation should reject logs when:

- entry ids are not unique;
- entries are not ordered by occurrence;
- a mutating entry lacks approved approval state;
- an apply entry lacks a command id, correlation id, source graph revision, or
  resulting graph revision;
- a dry-run entry claims a resulting graph revision;
- a tool entry uses a tool name, kind, schema name, approval class, or mutation
  flag that differs from the registered tool definition;
- an artifact handle is missing kind, storage class, id, or content hash when
  the producing tool promises artifacts;
- a replay reference is present without a content hash;
- redacted shared logs do not declare which fields were removed.

## Redaction Policy

The project-owned audit log may contain local paths, prompt text, provider
metadata, and source asset names. Shared PR artifacts must remove or replace:

- absolute user home paths unless the path is already a checked-in fixture;
- API keys, tokens, cookies, and bearer credentials;
- cloud endpoint secrets;
- user-entered prompts that contain private content;
- image metadata that contains private names, addresses, or GPS coordinates;
- generated captions or OCR text that is not needed to validate the tool
  contract.

Redaction must preserve stable hashes and structural evidence. A redacted log is
useful only if validators can still prove tool order, approval boundaries,
schema names, graph revisions, warnings, and replay identity.

## Storage Policy

Recommended local storage classes:

| Storage class      | Use                                                  |
| ------------------ | ---------------------------------------------------- |
| `session_temp`     | transient app-server run diagnostics; safe to delete |
| `project_audit`    | user-visible per-project history and undo evidence   |
| `sidecar_audit`    | portable per-image mutation trail                    |
| `fixture_artifact` | checked validation fixtures and CI replay inputs     |
| `export_archive`   | user-requested export package with provenance        |

Runtime tools should write atomically. Partially written logs must be marked
`failed` or discarded, never interpreted as successful evidence.

## Validation

Docs-only validation for this contract:

```sh
bunx prettier@3.8.3 --check docs/agent/tool-call-audit-log-2026-06-13.md docs/agent/tool-call-audit-log.sample.json
git diff --check
```

Runtime validation follow-ups should add:

- a Zod schema for the audit log;
- sample artifact drift checks;
- registry matching against RawEngine tool definitions;
- mutation approval tests;
- dry-run/apply graph revision tests;
- replay fixture linkage tests;
- iterative timeline ordering and replay-hash stability tests;
- redaction policy tests for shareable logs.

The audit log is complete only when it can be generated from a live app-server
tool-call session and validated without reading the chat transcript.
