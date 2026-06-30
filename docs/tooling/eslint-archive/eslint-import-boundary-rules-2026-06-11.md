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
- `import-x/no-named-as-default`
- `import-x/no-named-as-default-member`
- `import-x/order`
- `import-x/no-self-import`
- `import-x/no-useless-path-segments`
- `boundaries/element-types`
- `boundaries/entry-point`

The PR also records the boundary element map for app entrypoints, views, panels,
adjustments, modals, managers, UI primitives, context, hooks, schemas, store,
types, utilities, i18n, and window code.

## Legacy Fences

The first import/boundary run found legacy rule families that should be fixed in
focused follow-up PRs rather than hidden inside one large lint change.

| Count | Rule                          | Follow-Up Path                     |
| ----: | ----------------------------- | ---------------------------------- |
|    10 | `import-x/no-cycle`           | #542 dependency cycle audit        |
|   TBD | `boundaries/dependencies`     | #543 cross-layer dependency policy |
|   658 | `boundaries/no-unknown`       | #1287 element map completion       |
|     0 | `boundaries/no-unknown-files` | Promoted in #1948                  |

The duplicate-import findings were fixed in the first PR. Import ordering,
default-export import naming, and default-member import naming were later
promoted to blocking lint rules after focused cleanup PRs.

## Dependency Cycle Audit

Issue #542 measured `import-x/no-cycle` against the TypeScript graph on
June 11, 2026 and #1286 re-probed it on June 15, 2026. The rule is not enabled yet because the remaining cycles cross
type/value boundaries that should be split in focused refactor PRs rather than
hidden inside a lint-only change.

Measured command:

```sh
bun run check:lint
```

with `import-x/no-cycle` temporarily set to `error`.

June 15, 2026 probe result: 10 violations, about 42 seconds wall time. This is
high signal, but still too noisy for a global PR gate until the listed
component/store cycles are split.

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

## Boundary Policy Audit

Issue #543 enabled the boundary rules that are currently meaningful and green:

- `boundaries/element-types`
- `boundaries/entry-point`

The deprecated `boundaries/no-private` rule was intentionally not enabled. The
installed plugin recommends migrating private dependency checks to
`boundaries/dependencies`, which requires an explicit allow/disallow graph rather
than a legacy private-module rule.

June 11, 2026 measured command:

```sh
bun run check:lint
```

June 15, 2026 follow-up probe temporarily set `boundaries/no-unknown` and
`boundaries/no-unknown-files` to `error`. The result was 678 total findings:
658 `boundaries/no-unknown` import findings and 20
`boundaries/no-unknown-files` source-file findings.

Measured findings:

| Rule                          | Result                                                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `boundaries/element-types`    | 0 findings with the current element map.                                                                                                     |
| `boundaries/entry-point`      | 0 findings with the current element map.                                                                                                     |
| `boundaries/dependencies`     | Not enabled yet; a real layer graph is required before this rule applies useful pressure.                                                    |
| `boundaries/no-unknown`       | 658 findings when enabled. Most current imports resolve as unknown elements until dependency categories and package schema files are mapped. |
| `boundaries/no-unknown-files` | 0 findings after the #1948 descriptor cleanup.                                                                                               |

Resolved `boundaries/no-unknown-files` source groups:

- Root config files.
- App and validation entrypoints.
- Local declaration files.
- Repo scripts and pure TypeScript tests.
- `packages/rawengine-schema/**`.

Exit criteria before enabling `boundaries/dependencies`:

- Define the allowed layer graph for entry, app, views, panels, adjustments,
  modals, managers, UI, context, hooks, schemas, store, types, utils, i18n, and
  window elements.
- Keep `boundaries/no-unknown-files` green while reducing `boundaries/no-unknown`
  by mapping imported dependency
  categories and package schema elements.
- Decide whether type-only imports get a looser graph than value imports.
- Re-run `bun run check:lint` with `boundaries/dependencies`,
  `boundaries/no-unknown`, and `boundaries/no-unknown-files` set to `error`.

## Validation

Run these commands before merging import and boundary lint changes:

```sh
bun install --frozen-lockfile
bun run check:lint
bun run check:lint-escapes
bun run docs:check
```
