# Unused Vars Severity

Status: lint rule hardening.

## Scope

- Promotes `@typescript-eslint/no-unused-vars` from `warn` to `error`.
- Keeps the existing underscore ignore policy for intentional unused args, variables, and caught errors.

## Validation

- `bun run check:lint`
- `bun run check:types`
