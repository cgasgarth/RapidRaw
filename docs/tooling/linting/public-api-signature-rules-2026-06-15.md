# Public API Signature Rules

- Issue: #1353
- Scope:
  - `packages/rawengine-schema/src/**/*.ts`
  - `src/schemas/**/*.ts`
  - `src/utils/tauriSchemaInvoke.ts`
- Current decision: enable scoped `@typescript-eslint/typedef`; defer broader
  return-type and readonly-parameter rules.

## Probe Results

| Rule                                                 |       Result | Decision                     |
| ---------------------------------------------------- | -----------: | ---------------------------- |
| `@typescript-eslint/typedef`                         |   3 findings | Enabled after cleanup        |
| `@typescript-eslint/explicit-function-return-type`   |  23 findings | Defer; focused cleanup later |
| `@typescript-eslint/prefer-readonly-parameter-types` | 480 findings | Reject as a near-term gate   |

## Enabled Rule

Scoped `typedef` now requires explicit types for parameters, class member
variables, and property declarations in public schema/API boundary files. It does
not require every local variable declaration, which keeps inference usable inside
Zod builders and helper functions.

This is high signal because public schema modules, command bus code, and Tauri
schema wrappers are the contracts future app-server tools and UI editing
surfaces depend on.

## Deferred Rules

`explicit-function-return-type` is close enough for a later focused cleanup, but
the remaining 23 findings are mostly Zod helper callbacks and schema transform
helpers where inferred return types are currently readable.

`prefer-readonly-parameter-types` produced 480 findings across 47 files. Most are
Zod callback/object parameter noise and would require broad readonly modeling
before it becomes a useful gate.

## Validation

- `bun run check:lint`
- `bun run check:types`
- `bun run schema:check`
