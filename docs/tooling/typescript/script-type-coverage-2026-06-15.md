# Script Type Coverage

Status: baseline guard.

## Scope

- Adds a compact guard for JavaScript and MJS files under `scripts/`.
- Current baseline: `5/124` scripts contain `@ts-check`.
- Current debt cap: `119` scripts without `@ts-check`.
- The guard prevents this debt count from increasing while follow-up work decides whether to migrate scripts to `@ts-check`, TypeScript, or a dedicated scripts tsconfig.

## Rejected For This Slice

- Mass-adding `@ts-check`: too noisy without fixing all inferred JS errors.
- Migrating all scripts to TypeScript: too broad for a quality-gate slice.
- Blocking current baseline debt: useful long term, but not safe as a small PR.

## Validation

- `bun run check:script-type-coverage`
- `bun run check:script-type-coverage:self-test`
