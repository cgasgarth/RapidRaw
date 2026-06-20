# Unsafe Cast AST Guard

Status: lint guard hardening.

## Scope

- Replaces line-regex unsafe cast detection with TypeScript AST scanning.
- Keeps the public `bun run check:unsafe-casts` command.
- Adds `--self-test` coverage for direct `as any`, chained `as unknown as`, multiline chained assertions, and comments/strings.

## Validation

- `bun tests/integration/checks/check-unsafe-casts.ts --self-test`
- `bun run check:unsafe-casts`
