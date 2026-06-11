# ESLint Warning Inventory

Issue: #29

## Current Command Result

Audit command:

```sh
bunx eslint . --format json
```

Result on 2026-06-11:

| Metric              | Count |
| ------------------- | ----: |
| Files scanned       |   121 |
| Files with findings |     1 |
| Errors              |    15 |
| Warnings            |     5 |
| Fixable errors      |     0 |
| Fixable warnings    |     0 |

Current failing file:

| File                              | Findings | Errors | Warnings |
| --------------------------------- | -------: | -----: | -------: |
| `src/components/panel/Editor.tsx` |       20 |     15 |        5 |

Current rule inventory:

| Rule                                 | Count | Errors | Warnings |
| ------------------------------------ | ----: | -----: | -------: |
| `@typescript-eslint/no-explicit-any` |    15 |     15 |        0 |
| `@typescript-eslint/no-unused-vars`  |     5 |      0 |        5 |

## Finding Groups

`Editor.tsx` has five unused imports at the top of the file:

- `toast`
- `Text`
- `TextColors`
- `TextVariants`
- `TextWeights`

The explicit `any` findings fall into five cleanup groups:

| Lines                                  | Group                         | Recommended fix                                                                  |
| -------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| 74-75                                  | Editor prop contract          | Type `onContextMenu` and the transform wrapper ref with React/ref-facing types.  |
| 137, 162, 1022, 1034, 1037, 1069, 1077 | Mask overlay request contract | Add a local mask overlay request type or reuse the eventual mask schema type.    |
| 210                                    | Display size callback         | Add a named display-size interface matching the `handleDisplaySizeChange` shape. |
| 248                                    | Sub-mask update payload       | Type as a partial sub-mask payload instead of open-ended `any`.                  |
| 1319, 1885                             | Crop and sub-mask callbacks   | Type callback arguments from `PercentCrop`, `SubMask`, or a narrow adapter.      |

## Current Config State

The current ESLint config is flat-config based and includes:

- `@eslint/js` recommended rules for TypeScript files.
- `typescript-eslint` recommended rules.
- React, React Hooks, and i18next plugins.
- Unused variables as warnings with an underscore ignore convention.
- React Hooks rules-of-hooks as an error.
- React Hooks exhaustive-deps disabled until dependency-array debt has a focused cleanup issue.
- Zod-preferred restrictions that block AJV and TypeBox in TypeScript-facing validation code.
- A chained type assertion ban.

The config is not yet type-aware through TypeScript parser project service, so
strict type-checked rules should wait until the current `Editor.tsx` findings
are fixed and #30 wires project service cleanly.

## Recommended Order

1. Finish #286 by removing the `Editor.tsx` unused imports and replacing the 15
   explicit `any` sites with named local contracts or existing domain types.
2. Finish #36 by switching CI and local strict lint paths to `eslint .
--max-warnings 0` once the warning count is zero.
3. Finish #30 by enabling parser project service after the baseline command is
   clean.
4. Then layer #31-#35 in small PRs, starting with rules that have the clearest
   existing type support and lowest false-positive risk.
