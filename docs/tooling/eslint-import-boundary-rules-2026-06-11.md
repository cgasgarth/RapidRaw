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
|    10 | `import-x/no-cycle`                   | #542 dependency cycle audit        |
|   TBD | `boundaries/element-types`            | #543 cross-layer dependency policy |
|   TBD | `boundaries/entry-point`              | #543 public entrypoint policy      |
|   TBD | `boundaries/no-private`               | #543 private module access policy  |

The duplicate-import findings were fixed in this PR.

## Dependency Cycle Audit

Issue #542 measured `import-x/no-cycle` against the current TypeScript graph on
June 11, 2026. The rule is not enabled yet because the remaining cycles cross
type/value boundaries that should be split in focused refactor PRs rather than
hidden inside a lint-only change.

Measured command:

```sh
bun run check:lint
```

with `import-x/no-cycle` temporarily set to `error`.

Measured findings:

| File                                             | Cycle                                                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `src/components/panel/MainLibrary.tsx`           | Library panel imports library child modules that import `ColumnWidths` back from `MainLibrary`.             |
| `src/components/panel/library/LibraryGrid.tsx`   | Imports `ColumnWidths` from `MainLibrary`, creating `MainLibrary -> LibraryGrid -> MainLibrary`.            |
| `src/components/panel/library/LibraryHeader.tsx` | Imports `ADVANCED_QUERY_REGEX` from `useSortedLibrary`, while sorted-library code imports UI/library types. |
| `src/hooks/useSortedLibrary.ts`                  | Shares the `ADVANCED_QUERY_REGEX`/library header path and UI type imports.                                  |
| `src/components/panel/right/CropPanel.tsx`       | Exports `OverlayMode` while store/actions import it from the component module.                              |
| `src/hooks/useEditorActions.ts`                  | Imports app enum/types from UI modules that also participate in editor state cycles.                        |
| `src/store/useEditorStore.ts`                    | Imports `ToolType` from mask UI and `OverlayMode` from crop UI, coupling state to components.               |
| `src/store/useLibraryStore.ts`                   | Imports `ColumnWidths` from `MainLibrary`, coupling store state to a panel component.                       |
| `src/components/ui/AppProperties.tsx`            | Shared UI/type barrel participates in cycles through component imports.                                     |
| `src/components/ui/ExportImportProperties.tsx`   | Shared UI/type barrel participates in cycles through component imports.                                     |

Exit criteria before enabling `import-x/no-cycle`:

- Move shared library view types such as `ColumnWidths` out of
  `MainLibrary.tsx` into a neutral type module.
- Move editor state enums such as `OverlayMode` and `ToolType` out of component
  modules into neutral type modules.
- Keep `AppProperties.tsx` and `ExportImportProperties.tsx` as leaf type/UI
  modules, or split type-only exports from component/value exports.
- Re-run `bun run check:lint` with `import-x/no-cycle` set to `error` and update
  this table to zero before removing the rule fence.

## Validation

Run these commands before merging import and boundary lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
