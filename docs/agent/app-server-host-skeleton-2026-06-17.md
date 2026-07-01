# RawEngine App-Server Host Skeleton

Runtime status: supervised lifecycle proof for host discovery. This does not
claim a live expert image-editing agent or mutation-capable tool set.

Official reference checked: https://developers.openai.com/codex/app-server.

## Local Run

- Start the official sidecar with `codex app-server` when testing Codex app-server process behavior.
- Run RawEngine contract proof with `bun run check:rawengine-app-server-host`.
- Route local host requests through `handleRawEngineAppServerHostRequest` so each read tool shares one Zod-validated dispatcher path.
- Wrap stdio JSONL responses with `buildRawEngineAppServerHostResponseEnvelope` so request, response, transport, timestamp, status, and schema version are validated together.

## Boundary

Transport v1 is stdio JSONL. Socket, WebSocket, and long-running worker transports are deferred until the host has real mutation tools and replay fixtures.

No UI automation: host tools must call the typed RawEngine command/query layer only. They must not drive GUI actions, use raw Tauri invokes, or bypass command schemas.

## Lifecycle

The current lifecycle proof follows the official Codex app-server ordering:
connect, initialize once with client metadata, allow requests only after
initialization, then stop. `assertRawEngineAppServerLifecycleReady` rejects host
requests in `created` and `stopped` phases so app-server tools cannot run before
the connection handshake or after shutdown.

`buildRawEngineAppServerLifecycleReplay` records the `created -> initialized ->
stopped` sequence for stdio JSONL.

The desktop-owned supervisor state records command, process id, phase,
structured errors, cancellation request time, stop time, and audit events. The
local proof exercises `idle -> starting -> running -> stopping -> stopped`,
rejects invalid restarts, and preserves failure details such as
`health_timeout`. This is process-supervision state proof; wiring it to the
official Codex sidecar process remains the next runtime integration step.

`scripts/fixtures/rawengine-app-server-stdio-fixture.ts` gives the host checker
an executable stdio JSONL child process. The checker writes `initialize` and
`initialized`, validates the child response with Zod, records the actual process
id, marks the supervisor ready, and stops it. This proves launch/read/stop
supervision without requiring a local Codex login during CI.

## Tool Manifest

- `rawengine.host.health`: read-only health check returning runtime, transport, request id, and manifest tool count.
- `rawengine.host.capabilities`: read-only capability discovery returning the typed host tool list before an agent selects image-editing tools.
- `rawengine.host.route_catalog`: read-only mapped-route discovery for tone/color, computational merge, film look, Negative Lab, and AI routes.

The agent route catalog also exposes `rawengine.image.get_preview` as a safe
read-only image tool. It returns the current bounded medium preview handle and
metadata: ephemeral JPEG preview ref, width/height, source dimensions, edit
graph revision, recipe/render hashes, and an sRGB display-preview color note.
The response is metadata/handle only, never the original RAW payload, and the
tool is registered with `mutates: false`, `toolKind: read`, and
`approvalClass: safe_read`.

Initial prompt context now points at the same medium preview contract with
`toolName: rawengine.image.get_preview`, so app-server sessions can start with a
bounded 1536px-long-edge JPEG preview and later refresh or inspect it through a
typed read-only tool instead of raw Tauri invokes.

## Replay Evidence

`buildRawEngineAppServerHealthReplay`, `buildRawEngineAppServerCapabilitiesReplay`, and `buildRawEngineAppServerRouteCatalogReplay` record typed requests, responses, manifests, and audit log entries. The replay proof keeps host discovery read-only and auditable before mutation-capable feature tools are added.

`buildRawEngineAppServerHostResponseEnvelope` proves the dispatch path can produce one concrete stdio JSONL response envelope for health, capabilities, and route catalog tools. This is runtime apply-capable for read-only host discovery; image mutation tools remain deferred.
