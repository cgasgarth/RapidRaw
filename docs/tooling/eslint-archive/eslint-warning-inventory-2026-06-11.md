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

Updated status on 2026-06-12:

| Metric              | Count |
| ------------------- | ----: |
| Files scanned       |   132 |
| Files with findings |     0 |
| Errors              |     0 |
| Warnings            |     0 |

Current validation command:

```sh
bun run check:lint
```

`check:lint` now runs `eslint . --max-warnings 0` and is expected to stay green
on main.

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
- React Hooks exhaustive-deps and purity as errors.
- Zod-preferred restrictions that block AJV and TypeBox in TypeScript-facing validation code.
- A chained type assertion ban.
- Type-aware project service and strict type-checked rules, including
  `@typescript-eslint/unbound-method`, `no-unnecessary-condition`, and
  `restrict-template-expressions`, as hard gates.

The config is now type-aware through TypeScript parser project service. Future
lint hardening should update the targeted rule inventory rather than relying on
this inherited baseline snapshot.

## Recommended Order

1. Keep `bun run check:lint` at zero warnings on every PR.
2. Continue enabling remaining fenced React hook, accessibility, import, and
   boundary rules in focused PRs.
3. Refresh this inventory whenever a new broad lint family is measured.
