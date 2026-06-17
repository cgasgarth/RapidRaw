# RawEngine App-Server Host Skeleton

Runtime status: skeleton/route proof only. This does not claim a live expert image-editing agent, background process manager, or mutation-capable tool set.

Official reference checked: https://developers.openai.com/codex/app-server.

## Local Run

- Start the official sidecar with `codex app-server` when testing Codex app-server process behavior.
- Run RawEngine contract proof with `bun run check:rawengine-app-server-host`.

## Boundary

Transport v1 is stdio JSONL. Socket, WebSocket, and long-running worker transports are deferred until the host has real mutation tools and replay fixtures.

No UI automation: host tools must call the typed RawEngine command/query layer only. They must not drive GUI actions, use raw Tauri invokes, or bypass command schemas.

## Tool Manifest

- `rawengine.host.health`: read-only health check returning runtime, transport, request id, and manifest tool count.

## Replay Evidence

`buildRawEngineAppServerHealthReplay` records the typed request, response, manifest, and audit log entry. The replay fixture proves the first host route is read-only and auditable before feature tools are added.
