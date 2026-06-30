# TypeScript Stylistic Rule Evaluation

- Issue: #1317
- Candidate preset: `typescript-eslint` `stylisticTypeChecked`
- Current decision: enable a low-noise subset; defer the full preset.

## Full Preset Probe

Temporarily enabling `...tseslint.configs.stylisticTypeChecked` produced 665
violations across 11 rules.

| Count | Rule                                                   |
| ----: | ------------------------------------------------------ |
|   341 | `@typescript-eslint/prefer-nullish-coalescing`         |
|   228 | `@typescript-eslint/array-type`                        |
|    33 | `@typescript-eslint/prefer-optional-chain`             |
|    24 | `@typescript-eslint/no-empty-function`                 |
|    13 | `@typescript-eslint/no-inferrable-types`               |
|     7 | `@typescript-eslint/dot-notation`                      |
|     6 | `@typescript-eslint/consistent-type-definitions`       |
|     5 | `@typescript-eslint/non-nullable-type-assertion-style` |
|     4 | `@typescript-eslint/prefer-regexp-exec`                |
|     3 | `@typescript-eslint/consistent-indexed-object-style`   |
|     1 | `@typescript-eslint/prefer-for-of`                     |

## Enabled

These rules are enabled because the baseline was small and the fixes are
mechanical:

- `@typescript-eslint/consistent-indexed-object-style`
- `@typescript-eslint/prefer-for-of`
- `@typescript-eslint/prefer-regexp-exec`

## Deferred

- `prefer-nullish-coalescing`, `array-type`, `prefer-optional-chain`, and
  `no-empty-function` are too noisy for a single PR.
- `non-nullable-type-assertion-style` conflicts with the stricter existing
  non-null assertion ban.
- `dot-notation` can conflict with intentional bracket access used to avoid
  import/member ambiguity.
- `consistent-type-definitions` is deferred until schema/API type aliases are
  reviewed separately.

## Validation

- `bun run check:lint`
- `bun run check:types`
- `bun run check:format`
