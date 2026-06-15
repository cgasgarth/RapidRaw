# TypeScript Suppression Policy

Status: lint gate hardening.

TypeScript suppressions are explicit policy failures unless they preserve strong
type evidence:

- `@ts-ignore` is banned.
- `@ts-nocheck` is banned.
- `@ts-expect-error` is allowed only with a description of at least 12
  characters.
- `@ts-check` is not restricted by this rule.

Validation:

- `bun run check:lint`
- `bun run check:types`
