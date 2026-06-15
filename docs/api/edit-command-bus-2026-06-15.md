# Edit Command Bus

- Issue: #78 `api(commands): add edit command bus`
- Package: `packages/rawengine-schema/src/editCommandBus.ts`
- Validation: `bun run schema:command-bus`

## Scope

The schema package now has a small edit command bus that can:

- register one handler per command type;
- schema-validate unknown command payloads before handler execution;
- return structured invalid, unknown, handler-failed, and success results;
- list registered command types for diagnostics and generated tooling.

## Status

This is a command-dispatch foundation. It does not yet mutate the live editor
store, route React controls through the bus, replay graph operations, or call
Tauri. Follow-up issues must connect representative UI operations and runtime
apply paths before claiming end-to-end command-bus coverage.
