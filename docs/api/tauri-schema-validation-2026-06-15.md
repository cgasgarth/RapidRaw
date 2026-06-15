# Tauri Schema Validation Boundary

Status: partial runtime boundary coverage.

## Scope

- Adds a reusable `invokeWithSchema` helper that invokes Tauri with `unknown` response typing, parses with Zod, and throws a bounded diagnostic on failure.
- Adds a recursive Zod schema for folder tree payloads.
- Routes `get_folder_children` through the helper before the folder tree state is updated.

## Limits

- This is one representative bridge boundary, not full bridge validation.
- Existing `invoke<T>()` paths remain follow-up work under issue #76.
- No Rust schema generation or serde parity is included in this slice.

## Validation

- `bun run check:tauri-schema-validation`
