# RawEngine App-Server Host Skeleton

Runtime status: skeleton/route proof only. This does not claim a live expert image-editing agent, background process manager, or mutation-capable tool set.

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
stopped` sequence for stdio JSONL. This is lifecycle-state proof only; it does
not start the official Codex sidecar process or prove image mutation tools.

## Tool Manifest

- `rawengine.host.health`: read-only health check returning runtime, transport, request id, and manifest tool count.
- `rawengine.host.capabilities`: read-only capability discovery returning the typed host tool list before an agent selects image-editing tools.
- `rawengine.host.route_catalog`: read-only mapped-route discovery for tone/color, computational merge, film look, Negative Lab, and AI routes.

## Replay Evidence

`buildRawEngineAppServerHealthReplay`, `buildRawEngineAppServerCapabilitiesReplay`, and `buildRawEngineAppServerRouteCatalogReplay` record typed requests, responses, manifests, and audit log entries. The replay proof keeps host discovery read-only and auditable before mutation-capable feature tools are added.

`buildRawEngineAppServerHostResponseEnvelope` proves the dispatch path can produce one concrete stdio JSONL response envelope for health, capabilities, and route catalog tools. This is runtime apply-capable for read-only host discovery; image mutation tools remain deferred.
