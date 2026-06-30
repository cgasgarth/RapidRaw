# App-Server Agent Demo Workflow

- Snapshot date: 2026-06-13
- Issue: #230 `agent(demo): add agent demo workflow`
- Scope: local demo contract for an OpenAI Codex app-server based RawEngine
  editing agent.
- Official source checked: <https://developers.openai.com/codex/app-server>

## Purpose

This document defines the first demo workflow RawEngine should use to prove an
expert chat agent can inspect, preview, approve, apply, and replay an edit
without bypassing the typed RawEngine command layer.

It is not a runtime implementation claim. The demo is a contract for the next
implementation PRs: if a runtime behavior cannot produce this evidence, the
agent integration is not ready to become a user-visible editing surface.

## Official App-Server Constraints

The current OpenAI Codex app-server docs describe app-server as the rich-client
protocol for authentication, conversation history, approvals, and streamed agent
events. The protocol uses JSON-RPC style request, response, and notification
messages over local transports. Stdio is the default transport and sends
newline-delimited JSON. Clients initialize the connection, send the initialized
notification, start or resume a thread, start a turn, then keep reading streamed
thread, turn, item, and server-request notifications.

RawEngine v1 should demo against stdio first because it is deterministic,
local-only, and easiest to replay in fixtures. Unix socket integration can come
later for app lifecycle management. WebSocket should remain diagnostic-only
until authentication, queueing, and local exposure policy are fully validated.

## Demo Scenario

The v1 demo should use one local RAW or rendered sample image and a
non-destructive tone/color edit:

1. User asks: `Make this image warmer, lift the shadows slightly, and protect
highlights. Show me the preview before applying.`
2. Agent reads current image, graph revision, metadata, and available scopes.
3. Agent proposes a tone/color plan with expected visual effect and known
   limitations.
4. Agent invokes a dry-run tone/color tool.
5. RawEngine returns a parameter diff, warning list, graph revision, and preview
   artifact handle.
6. UI displays the preview artifact and command summary.
7. User approves the mutation.
8. Agent invokes the matching apply tool with the accepted dry-run reference,
   expected graph revision, and approval record.
9. RawEngine applies the edit through the same command layer used by UI/tests.
10. Agent reports the final graph revision, changed nodes, warnings, undo
    revision, and replay record location.

## Transport And Message Flow

The demo runner should start Codex app-server locally:

```sh
codex app-server
```

The first implementation may wrap that process from Bun or Rust, but the demo
contract is transport-neutral after initialization:

1. Start app-server with stdio JSONL.
2. Send `initialize`.
3. Send `initialized`.
4. Send `thread/start` or resume a known demo thread.
5. Send the user turn.
6. Stream notifications until `turn/completed`, `turn/interrupted`, or
   `turn/failed`.
7. Persist a RawEngine replay fixture independent of the chat transcript.

The demo must treat streamed `item/*` notifications as the authoritative source
for tool-call, file-change, and agent-message events. Aggregated turn diff or
plan notifications are useful UI summaries, but they are not enough to validate
image-edit behavior.

## RawEngine Tool Sequence

The demo should expose only narrow tool families:

| Step | Tool class | Example tool                | Mutates | Required evidence                            |
| ---- | ---------- | --------------------------- | ------- | -------------------------------------------- |
| 1    | Read       | `editgraph.snapshot`        | No      | graph revision and node summary              |
| 2    | Preview    | `preview.read_scopes`       | No      | histogram/scope summary or artifact handle   |
| 3    | Dry-run    | `tonecolor.dry_run_command` | No      | parameter diff and preview artifact          |
| 4    | Apply      | `tonecolor.apply_command`   | Yes     | approval record and resulting graph revision |
| 5    | Replay     | `agent.replay.validate`     | No      | deterministic replay fixture result          |

The apply step must fail if:

- the expected graph revision is stale;
- the approval state is not `approved`;
- the dry-run reference is missing when required by the tool contract;
- the command payload does not satisfy its Zod schema;
- the tool name, input schema, output schema, approval class, or mutation flag
  differs from the registered tool definition.

## Demo Artifacts

Every successful demo run should produce:

- app-server session id, thread id, turn id, and RawEngine correlation id;
- source asset path or fixture id;
- initial graph revision;
- dry-run command envelope;
- dry-run result with preview artifact handle;
- approval record;
- apply command envelope;
- mutation result with final graph revision and undo revision;
- replay fixture JSON;
- preview screenshot or rendered comparison when a UI surface exists;
- validation command output.

The checked schema fixture added for #226 is the initial replay shape:

```text
packages/rawengine-schema/samples/agent/agent-replay-fixture-v1.json
```

Runtime demos should eventually produce the same shape from a live tool-call
session, not hand-authored JSON.

## UX Expectations

The user-facing demo should feel like an expert editing assistant, not a generic
chatbot:

- keep the image and preview result visible while the agent explains changes;
- show concrete parameter changes, not vague prose;
- show before/after preview handles before approval;
- name affected image, virtual copy, layer, or mask;
- show warning severity and confidence;
- make approval explicit for any persistent sidecar or graph mutation;
- provide a one-click undo path using the returned undo revision;
- avoid dumping JSON unless the user opens a developer details panel.

## Validation Loop

Docs-only PR validation:

```sh
bunx prettier@3.8.3 --check docs/agent/app-server-demo-workflow-2026-06-13.md docs/index.md docs/site-navigation.json
git diff --check
```

Runtime PR validation must add:

```sh
bun run schema:check
bun run check:unsafe-casts
bun run check:types
bun run check:lint
```

Runtime demo PRs should also attach:

- app-server transcript excerpt with secrets removed;
- replay fixture path and hash;
- before/after preview screenshot;
- command/replay validation output;
- any skipped checks with reason.

## Follow-Up Implementation Slices

Recommended next PR order:

1. Add an app-server demo runner that starts stdio app-server and records the
   initialize/thread/turn lifecycle without image mutation.
2. Add a read-only RawEngine tool adapter for project/image/graph state.
3. Add tone/color dry-run adapter wired to the schema package.
4. Add approval record persistence.
5. Add tone/color apply adapter with stale-revision failure tests.
6. Generate a replay fixture from the live demo and compare it to the schema
   fixture contract.
7. Add a UI demo panel that shows agent plan, preview, approval, and final
   result.

Each slice should be small enough to validate with one focused PR and should
close or update the linked GitHub issue before moving to broader feature work.
