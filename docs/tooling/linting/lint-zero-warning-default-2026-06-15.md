# Lint Zero-Warning Default

Status: local command hardening.

## Scope

- Makes `bun run lint` match PR lint semantics by denying ESLint warnings.
- Keeps `lint:fix` unchanged for repair workflows.

## Validation

- `bun run lint`
- `bun run check:lint`
