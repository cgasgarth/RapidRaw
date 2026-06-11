# ESLint TypeScript Project Service

Issue: #30

## Contract

ESLint uses typescript-eslint project service for TypeScript parsing. This gives
future type-checked rules the same TypeScript project graph used by the editor
and avoids a separate `tsconfig.eslint.json` that could drift from
`tsconfig.json`.

## Configuration

- `parserOptions.projectService` is enabled in `eslint.config.js`.
- `tsconfigRootDir` is pinned to the repository root through `__dirname`.
- `allowDefaultProject` is limited to root-level `*.ts` files so
  `i18next.config.ts` can be linted without widening the app `tsconfig.json`.

## Follow-Up

#31 should add strict type-checked rule presets after this project-service
baseline is green in CI.

## Validation

Run these commands before merging changes to the project-service baseline:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
