# Tauri Schema Validation Boundary

Status: partial runtime boundary coverage.

## Scope

- Adds a reusable `invokeWithSchema` helper that invokes Tauri with `unknown` response typing, parses with Zod, and throws a bounded diagnostic on failure.
- Adds a recursive Zod schema for folder tree payloads.
- Routes `get_folder_children` through the helper before the folder tree state is updated.
- Adds a Tauri boundary ledger at `fixtures/validation/app-server/tauri-boundary-ledger.json`.
- Adds positive and negative parse fixtures for `get_folder_children` and
  `get_albums`.

## Status Ledger

Ledger entries map:

- Tauri command string and `Invokes` enum member;
- TypeScript call sites using `invokeWithSchema`;
- Zod schema used at the boundary;
- positive and negative payload fixtures;
- Rust parity state;
- proof status: `uncovered`, `schema-only`, `runtime-parse-tested`,
  `rust-parity-tested`, or `e2e-proven`.

Current entries are `runtime-parse-tested`: they prove TypeScript parse behavior
and bounded rejection messages. They do not claim Rust serde parity or full E2E
proof.

## Limits

- This is one representative bridge boundary, not full bridge validation.
- Existing `invoke<T>()` paths remain follow-up work under issue #76.
- No Rust schema generation or serde parity is included in this slice.

## Validation

- `bun run check:tauri-schema-validation`
- `bun run check:types`
- `bun run check:unsafe-casts`
