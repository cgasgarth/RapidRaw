# ESLint Import And Boundary Rules

Issue: #34

## Contract

Import linting uses `eslint-plugin-import-x` with its official recommended and
TypeScript flat configs plus `eslint-import-resolver-typescript` for TypeScript
resolution. Boundary linting uses `eslint-plugin-boundaries` with an explicit
element map for the current `src/` topology.

## Enabled Now

The first gate enables rules that pass after small local cleanup:

- `import-x/no-duplicates`
- `import-x/no-self-import`
- `import-x/no-useless-path-segments`

The PR also records the boundary element map for app entrypoints, views, panels,
adjustments, modals, managers, UI primitives, context, hooks, schemas, store,
types, utilities, i18n, and window code.

## Legacy Fences

The first import/boundary run found legacy rule families that should be fixed in
focused follow-up PRs rather than hidden inside one large lint change.

| Count | Rule                                  | Follow-Up Path                     |
| ----: | ------------------------------------- | ---------------------------------- |
|    77 | `import-x/no-named-as-default`        | #540 default export import naming  |
|    21 | `import-x/no-named-as-default-member` | #544 React/i18n member imports     |
|   TBD | `import-x/order`                      | #539 import ordering cleanup       |
|   TBD | `import-x/no-cycle`                   | #542 dependency cycle audit        |
|   TBD | `boundaries/element-types`            | #543 cross-layer dependency policy |
|   TBD | `boundaries/entry-point`              | #543 public entrypoint policy      |
|   TBD | `boundaries/no-private`               | #543 private module access policy  |

The duplicate-import findings were fixed in this PR.

## Validation

Run these commands before merging import and boundary lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
